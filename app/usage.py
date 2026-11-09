"""Storage statistics: how long ago a blob was used, how much space each namespace, repository and tag holds, and how the
total changes over time. Sizes come from manifests (read from the storage mount when there is one, else over the registry API).
Ages and the on-disk total need UI_REGISTRY_STORAGE_MOUNT, the registry's filesystem storage mounted read-only."""
import logging
import os
import threading
import time

import registry as R

log = logging.getLogger("usage")

HOUR, DAY = 3600, 86400
KEEP_DAYS, HOURLY_DAYS = 90, 7  # history is kept this long, and hourly for this long before it is thinned to one point per day
TOP_REPOS = 20  # repositories recorded in each history point
MAX_LEAVES = 100  # tags (digests) shown per repository in the map, the rest are folded into one "other" leaf
MAX_POINTS = 2000
SOURCE_RANK = {"atime": 2, "mtime": 1, "created": 0}


def pick_age(atime, mtime, birth=None):
    """(seconds, source) for when a file was last used. The access time when it is newer than the modification time, which
    only happens if the filesystem records it (a host mount with relatime or strictatime, not noatime). Else the modification
    time, else the birth time where the platform has one. None when the file has none of them."""
    if atime and atime > (mtime or 0):
        return int(atime), "atime"
    if mtime:
        return int(mtime), "mtime"
    if birth:
        return int(birth), "created"
    return None


def newest(a, b):
    """The later of two (seconds, source) ages, either may be None."""
    if a is None or b is None:
        return a or b
    return max(a, b, key=lambda x: (x[0], SOURCE_RANK.get(x[1], -1)))


def blob_path(mount, digest):
    alg, hexed = digest.split(":")
    return os.path.join(mount, R.STORAGE, "blobs", alg, hexed[:2], hexed, "data")


def blob_age(mount, digest):
    """[seconds, source] for a blob in the registry's storage, or None without the storage or the file."""
    if not mount or not R.DIGEST_RE.fullmatch(digest or ""):
        return None
    try:
        st = os.stat(blob_path(mount, digest))
    except OSError:
        return None
    age = pick_age(st.st_atime, st.st_mtime, getattr(st, "st_birthtime", None))
    return list(age) if age else None


def fs_usage(path):
    """{"total", "used", "free"} bytes of the filesystem holding path, or None."""
    try:
        v = os.statvfs(path)
    except OSError:
        return None
    return {"total": v.f_blocks * v.f_frsize, "used": (v.f_blocks - v.f_bfree) * v.f_frsize, "free": v.f_bavail * v.f_frsize}


def disk_total(mount):
    """(bytes, files) of every blob data file in the storage, referenced by a tag or not."""
    total = files = 0
    root = os.path.join(mount, R.STORAGE, "blobs")
    for here, _, names in os.walk(root):
        if "data" in names:
            try:
                total += os.stat(os.path.join(here, "data")).st_size
                files += 1
            except OSError:
                pass
    return total, files


def manifest_blobs(data, mtype=None):
    """(child manifest digests, {blob digest: size}, layer digests) of a manifest, from its bytes. Entries that are not well formed are left out."""
    m = R.json_load(data)
    ok = lambda d: isinstance(d, dict) and isinstance(d.get("digest"), str) and R.DIGEST_RE.fullmatch(d["digest"])  # noqa: E731
    kids = [d["digest"] for d in m.get("manifests", []) if ok(d)] if isinstance(m.get("manifests"), list) else []
    config = [m["config"]] if isinstance(m.get("config"), dict) else []
    layers = m["layers"] if isinstance(m.get("layers"), list) else []
    blobs = {d["digest"]: (d["size"] if isinstance(d.get("size"), int) and d["size"] >= 0 else 0) for d in config + layers if ok(d)}
    return kids, blobs, {d["digest"] for d in layers if ok(d)}


def blobs_of(read, digest, depth=0):
    """(blobs, layers): every blob a manifest keeps alive, itself and its index children included, as {digest: size}, and which
    of them are layers. read(digest) returns the manifest bytes or raises; one that cannot be read counts as nothing."""
    try:
        data = read(digest)
        kids, blobs, layers = manifest_blobs(data)
    except (R.RegistryError, OSError):
        return {}, set()
    out, found = {digest: len(data), **blobs}, set(layers)
    if depth < R.MAX_DEPTH:
        for kid in kids:
            more, more_layers = blobs_of(read, kid, depth + 1)
            out.update(more)
            found |= more_layers
    return out, found


def spread(ages):
    """(oldest, newest) of a list of (seconds, source) ages, either None when there is none."""
    ages = [tuple(a) for a in ages if a]
    if not ages:
        return None, None
    return list(min(ages, key=lambda x: x[0])), list(max(ages, key=lambda x: (x[0], SOURCE_RANK.get(x[1], -1))))


def merged(kids, name):
    """One node standing for several: sizes and counts added, ages spread over them."""
    oldest, newest = spread([k["oldest"] for k in kids] + [k["newest"] for k in kids])
    return {"name": name, "kind": "other", "size": sum(k["size"] for k in kids), "held": sum(k["held"] for k in kids), "tags": sum(k["tags"] for k in kids),
            "oldest": oldest, "newest": newest, "kids": []}


def folded(kids, limit=MAX_LEAVES):
    """The `limit` largest nodes, and one "other" node holding the rest."""
    if len(kids) <= limit:
        return kids
    kids = sorted(kids, key=lambda k: -k["size"])
    return kids[:limit - 1] + [merged(kids[limit - 1:], f"other ({len(kids) - limit + 1})")]


def prefixes(path):
    """"a/b/c" -> ["", "a", "a/b", "a/b/c"]: the folders a repository sits in, from the top, and itself."""
    out, here = [""], ""
    for part in path.split("/") if path else []:
        here = f"{here}/{part}" if here else part
        out.append(here)
    return out


def common_prefix(paths):
    """The longest folder path that every one of `paths` is in or equal to, "" for none."""
    split = [p.split("/") for p in paths]
    out = []
    for parts in zip(*split):
        if len(set(parts)) != 1:
            break
        out.append(parts[0])
    return "/".join(out)


def child_name(folder, repo):
    """Which item of `folder` a repository belongs to: the next path segment, or "(this repository)" for the folder itself."""
    if repo == folder:
        return "(this repository)"
    rest = repo[len(folder) + 1:] if folder else repo
    return rest.split("/")[0]


def tag_label(names):
    names = sorted(names)
    return ", ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else "")


def blank():
    return {"size": 0, "held": 0, "tags": 0, "used": None, "oldest": None, "newest": None, "kids": []}


def analyse(tags, blobs_by_digest, ages=None, kinds=None):
    """Work out the numbers from {repo:tag: digest}, {digest: {blob: size}} and, with the storage, {blob: (seconds, source)}.
    Returns {"total": unique bytes, "repos": {repo: bytes in it, shared layers included}, "tree": the map,
    "ages": {repo: {tag: [seconds, source]}}, "holders": {blob: leaves that use it}, "sizes": {blob: size}, "leaves": {(repo, digest): tag names}}.
    The map follows every path segment: folders, then repositories, then tags (a path can be both a repository and a folder). A blob that
    several tags use is counted once in "size", at the lowest level that holds all of its users: the tag, else a "shared" item of the
    deepest folder (or repository) that contains them all. Tags on one digest are one leaf, named by its tags. A node's "held" counts every
    blob under it, shared or not, so held minus size is what it shares with the rest. "tags" counts tag names. "oldest" and "newest" are the
    last-used ages of the tags under it. A tag's age is the newest layer only that image holds, so a base layer other images pull does not
    make it look used, and the newest of all its layers when it has none of its own. kinds: {digest: image|helm|artifact}."""
    ages, kinds = ages or {}, kinds or {}
    leaves = {}  # (repo, digest) -> tag names
    for ref, digest in tags.items():
        repo, _, tag = ref.rpartition(":")
        leaves.setdefault((repo, digest), []).append(tag)
    holders, sizes = {}, {}  # blob -> the leaves that use it, blob -> its size
    for leaf in leaves:
        for blob, size in blobs_by_digest.get(leaf[1], {}).items():
            holders.setdefault(blob, set()).add(leaf)
            sizes[blob] = size
    folders, leaf_nodes, shared = {}, {}, {}

    def folder(path):
        if path not in folders:
            folders[path] = {"name": path.rpartition("/")[2], "path": path, "kind": "folder", **blank()}
            if path:
                folder(path.rpartition("/")[0])["kids"].append(folders[path])
        return folders[path]

    top = folder("")
    for (repo, digest), names in leaves.items():  # every tag is in the map, also one whose layers all belong to others
        node = folder(repo)
        node["kind"] = "repo"
        node["repo"] = repo
        leaf = {"name": tag_label(names), "kind": "tag", "repo": repo, "tag": sorted(names)[0], "digest": digest, "type": kinds.get(digest, "image"), **blank()}
        leaf["tags"] = len(names)
        node["kids"].append(leaf)
        leaf_nodes[(repo, digest)] = leaf
        for p in prefixes(repo):
            folders[p]["tags"] += len(names)
    for node in folders.values():  # a repository of charts or artifacts shows that icon, one of images the usual one
        types = {k["type"] for k in node["kids"] if k["kind"] == "tag"}
        if types:
            node["type"] = types.pop() if len(types) == 1 else "image"

    def shared_leaf(path, one_repo):
        key = (path, one_repo)
        if key not in shared:
            name = "Layers used by more than one tag" if one_repo else (
                "Layers used by more than one top-level folder" if not path else f"Layers used by more than one item in {path}")
            shared[key] = {"name": name, "kind": "shared", "path": path, "sharers": {}, **blank()}
            folder(path)["kids"].append(shared[key])
        return shared[key]

    per_repo, own_age = {}, {}  # own_age: leaf -> newest layer age among the layers only that leaf holds
    for blob, who in holders.items():
        repos = {r for r, _ in who}
        age, size = ages.get(blob), sizes[blob]
        if len(who) == 1:
            (r, d), = who
            target, chain = leaf_nodes[(r, d)], prefixes(r)
            own_age[(r, d)] = newest(own_age.get((r, d)), age)
        else:
            where = common_prefix(repos)
            target, chain = shared_leaf(where, len(repos) == 1), prefixes(where)
            for name in {child_name(where, r) for r in repos}:
                target["sharers"][name] = target["sharers"].get(name, 0) + size
        for p in chain:
            folders[p]["size"] += size
            folders[p]["used"] = newest(folders[p]["used"], age)
        target["size"] += size
        target["held"] += size if target["kind"] == "shared" else 0  # a tag leaf's held is added with the other holders below
        target["used"] = newest(target["used"], age)
        for p in {q for r in repos for q in prefixes(r)}:
            folders[p]["held"] += size
        for leaf in who:
            leaf_nodes[leaf]["held"] += size
        for r in repos:
            per_repo[r] = per_repo.get(r, 0) + size
    out_ages, leaf_age = {}, {}
    for (repo, digest), names in leaves.items():
        every = None
        for blob in blobs_by_digest.get(digest, {}):
            every = newest(every, ages.get(blob))
        used = own_age.get((repo, digest)) or every
        leaf_age[(repo, digest)] = used
        for t in names if used else ():
            out_ages.setdefault(repo, {})[t] = list(used)
        node = leaf_nodes[(repo, digest)]
        node["oldest"] = node["newest"] = list(used) if used else None

    def settle(n):  # ages of a node from its kids, bottom up; a shared item has the age of its blobs
        if n["kids"]:
            for k in n["kids"]:
                settle(k)
            n["oldest"], n["newest"] = spread([k["oldest"] for k in n["kids"]] + [k["newest"] for k in n["kids"]])
        elif n["oldest"] is None and n["used"]:
            n["oldest"] = n["newest"] = list(n["used"])
        n["used"] = list(n["used"]) if n["used"] else None
    settle(top)
    for n in [*folders.values(), *shared.values()]:
        if "sharers" in n:
            n["sharers"] = sorted(n["sharers"].items(), key=lambda kv: (-kv[1], kv[0]))[:50]
    for n in folders.values():  # only the tags of a repository are folded: every folder and repository stays listed
        n["kids"] = sorted(n["kids"], key=lambda k: (-k["size"], k["name"]))
        if n["kind"] == "repo":
            tag_kids = [k for k in n["kids"] if k["kind"] == "tag"]
            if len(tag_kids) > MAX_LEAVES:
                n["kids"] = [k for k in n["kids"] if k["kind"] != "tag"] + folded(tag_kids)
    return {"total": top["size"], "repos": per_repo, "tree": top, "ages": out_ages, "holders": holders, "sizes": sizes, "leaves": leaves,
            "leaf_age": leaf_age}


def freed(selected, holders, sizes, blobs=None):
    """Bytes garbage collection frees once the leaves in `selected` are gone: the blobs every holder of which is selected."""
    count = {}
    for leaf in selected:
        for blob in (blobs or {}).get(leaf, ()):
            count[blob] = count.get(blob, 0) + 1
    return sum(sizes[b] for b, c in count.items() if c == len(holders[b]))


def stale_summary(result, blobs_by_digest, now, days=180):
    """(tags, bytes) of the tags not used for `days`, and what garbage collection frees if all of them go. None without ages."""
    if not result["ages"]:
        return None
    limit = now - days * DAY
    stale = [leaf for leaf, age in result["leaf_age"].items() if age and age[0] < limit]
    blobs = {leaf: blobs_by_digest.get(leaf[1], {}) for leaf in stale}
    return {"tags": sum(len(result["leaves"][leaf]) for leaf in stale),
            "frees": freed(stale, result["holders"], result["sizes"], blobs)}


def repo_detail(result, blobs_by_digest, repo, pushed=None):
    """The rows of one repository's Storage tab, from the latest scan. blobs: [[size, holders]] of every blob its tags use, each tag
    lists the indexes of its blobs, so the page can add up what a selection frees. pushed: {tag: seconds}."""
    pushed = pushed or {}
    index, blobs, rows = {}, [], []
    for (r, digest), names in sorted(result["leaves"].items()):
        if r != repo:
            continue
        mine = []
        for blob, size in blobs_by_digest.get(digest, {}).items():
            if blob not in index:
                index[blob] = len(blobs)
                blobs.append([size, len(result["holders"][blob])])
            mine.append(index[blob])
        own = sum(blobs[i][0] for i in mine if blobs[i][1] == 1)
        names = sorted(names, key=lambda t: (t == "latest", t))
        age = result["leaf_age"].get((r, digest))
        for i, t in enumerate(names):
            rows.append({"tag": t, "digest": digest, "size": sum(blobs[i][0] for i in mine), "frees": own if i == 0 else 0, "shares": names[0] if i else None,
                         "used": list(age) if age else None, "pushed": pushed.get(t), "blobs": mine if i == 0 else []})
    return {"blobs": blobs, "tags": rows}


def thin(points, now, keep_days=KEEP_DAYS, hourly_days=HOURLY_DAYS):
    """History points no older than keep_days, with those older than hourly_days cut to the last point of each day (UTC)."""
    points = sorted((p for p in points if now - p["t"] <= keep_days * DAY), key=lambda p: p["t"])
    cut = now - hourly_days * DAY
    days, recent = {}, []
    for p in points:
        if p["t"] < cut:
            days[int(p["t"] // DAY)] = p  # the last of the day wins
        else:
            recent.append(p)
    return [*days.values(), *recent][-MAX_POINTS:]


def history_point(now, total, disk, repos):
    """One point for the history: total unique bytes, the on-disk total (None without the storage) and the largest repositories."""
    top = sorted(repos.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_REPOS]
    return {"t": int(now), "total": total, "disk": disk, "repos": dict(top)}


RESCAN_GAP = 60  # seconds: after a change the registry sees, the next scan comes no sooner than this


def scan_due(now, last_scan, interval, seq, seen_seq, gap=RESCAN_GAP):
    """Whether a scan is due: every `interval` seconds, or `gap` seconds after the last one when a tag changed (a push or a delete)."""
    return last_scan is None or now - last_scan >= interval or (seq != seen_seq and now - last_scan >= gap)


class Usage(threading.Thread):
    """Scans the tags the poller knows every `interval` seconds, keeps the latest result and adds a point to the history."""
    def __init__(self, client, state, mount, interval=HOUR, clock=time.time):
        super().__init__(daemon=True, name="usage")
        self.client, self.state, self.mount, self.interval, self.clock = client, state, mount, interval, clock
        self.stop, self.latest, self.lock = threading.Event(), None, threading.Lock()
        self.cache = {}  # digest -> (blobs, layers); a digest names its content, so it never changes
        self.throttle = None

    def reader(self, repo):
        def read(digest):
            if self.mount:  # the manifest is a blob in the storage, so no request is made
                try:
                    with open(blob_path(self.mount, digest), "rb") as f:
                        data = f.read(R.MAX_BODY + 1)
                    if len(data) <= R.MAX_BODY:
                        return data
                except OSError:
                    pass
            return self.client.manifest(repo, digest)[0]
        return read

    def scan(self, record=True):
        with self.state.cond:
            tags = {k: v["digest"] for k, v in self.state.tags.items()}
        cache = {}
        for ref, digest in tags.items():
            if digest not in cache:
                cache[digest] = self.cache.get(digest) or blobs_of(self.reader(ref.rpartition(":")[0]), digest)
        self.cache = {d: v for d, v in cache.items() if v[0]}  # digests no tag points at any more are dropped; a failed read is tried again
        ages = {}
        if self.mount:  # layers only: the UI itself reads manifests and configs, which would make every image look used
            for _, layers in cache.values():
                for blob in layers:
                    if blob not in ages:
                        age = blob_age(self.mount, blob)
                        if age:
                            ages[blob] = tuple(age)
        by_digest = {d: b for d, (b, _) in cache.items()}
        with self.state.cond:
            kinds = {d: v.get("kind") for d, v in self.state.meta.items() if v.get("kind")}
        result = analyse(tags, by_digest, ages, kinds)
        unread = sorted(ref for ref, digest in tags.items() if not by_digest.get(digest))  # manifests that could not be read: not in any figure
        disk = files = None
        if self.mount:
            disk, files = disk_total(self.mount)
        now = self.clock()
        # Judged per scan: when no layer has an access time newer than its modification time, atime is not being recorded (noatime, or
        # an NFS server that does not update it) and every age is a push time.
        recorded = any(a[1] == "atime" for a in ages.values())
        result.update({"updated": int(now), "mount": bool(self.mount), "disk": disk, "files": files, "tags": len(tags), "blobs": len({b for v, _ in cache.values() for b in v}),
                       "unread": {"count": len(unread), "first": unread[:5]}, "atime": recorded if ages else None, "stale": stale_summary(result, by_digest, now), "by_digest": by_digest,
                       "unreferenced": max(0, disk - sum(result["sizes"].values())) if disk is not None else None})
        with self.lock:
            self.latest = result
        if record:
            self.state.add_usage(history_point(now, result["total"], disk, result["repos"]), now)
        return result

    def snapshot(self):
        with self.lock:
            return self.latest

    def run(self):
        last_scan = last_point = seen = None
        while not self.stop.is_set():
            if self.state.baselined:
                now = self.clock()
                if scan_due(now, last_scan, self.interval, self.state.seq, seen):
                    seen = self.state.seq  # read first: a change during the scan is caught by the next one
                    record = last_point is None or now - last_point >= self.interval * 0.9  # a point of the history at most once an interval, though a change rescans sooner
                    try:
                        self.scan(record=record)
                        if record:
                            last_point = now
                    except Exception as e:  # never die: try again next time
                        log.warning("usage scan failed: %s", getattr(e, "message", e))
                    last_scan = now
            if self.stop.wait(10):
                return
