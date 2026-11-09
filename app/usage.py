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


def folded(kids, limit=MAX_LEAVES):
    """The `limit` largest nodes, and one "other" node holding the rest."""
    if len(kids) <= limit:
        return kids
    kids = sorted(kids, key=lambda k: -k["size"])
    rest = kids[limit - 1:]
    used = None
    for k in rest:
        used = newest(used, tuple(k["used"]) if k.get("used") else None)
    return kids[:limit - 1] + [{"name": f"other ({len(rest)})", "size": sum(k["size"] for k in rest), "used": list(used) if used else None, "kids": []}]


def namespace(repo):
    return repo.split("/")[0] if "/" in repo else ""


def tag_label(names):
    names = sorted(names)
    return ", ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else "")


def analyse(tags, blobs_by_digest, ages=None):
    """Work out the numbers from {repo:tag: digest}, {digest: {blob: size}} and, with the storage, {blob: (seconds, source)}.
    Returns {"total": unique bytes, "repos": {repo: unique bytes in it}, "tree": the map, "ages": {repo: {tag: [seconds, source]}}}.
    The map has the levels namespace, repository and tag. A blob that several tags use is counted once, at the lowest level that
    holds all of them: the tag, else a "shared" leaf of their repository, of their namespace, or of the top. Tags on one digest
    are one leaf, named by its tags. A node's "used" is the newest age of any blob under it."""
    ages = ages or {}
    leaves = {}  # (repo, digest) -> tag names
    for ref, digest in tags.items():
        repo, _, tag = ref.rpartition(":")
        leaves.setdefault((repo, digest), []).append(tag)
    holders, sizes = {}, {}  # blob -> the leaves that use it, blob -> its size
    for leaf in leaves:
        for blob, size in blobs_by_digest.get(leaf[1], {}).items():
            holders.setdefault(blob, set()).add(leaf)
            sizes[blob] = size
    nodes = {}  # key -> node; a key is ("n", ns), ("r", ns, repo), ("t", ns, repo, digest), or ("s", ...) for a shared leaf

    def get(key, parent):
        if key not in nodes:
            kind = key[0]
            ns = key[1] if len(key) > 1 else ""
            if kind == "n":
                n = {"name": ns or "(top level)"}
            elif kind == "r":
                n = {"name": key[2], "repo": key[2]}
            elif kind == "t":
                names = leaves[(key[2], key[3])]
                n = {"name": tag_label(names), "repo": key[2], "tag": sorted(names)[0]}
            else:
                n = {"name": "shared by " + ("tags of " + key[2] if len(key) == 3 else "repositories of " + (ns or "(top level)") if len(key) == 2 else "namespaces")}
            nodes[key] = {**n, "size": 0, "used": None, "kids": []}
            if parent is not None:
                nodes[parent]["kids"].append(nodes[key])
        return nodes[key]

    top = nodes[()] = {"name": "", "size": 0, "used": None, "kids": []}
    per_repo = {}
    for blob, who in holders.items():
        repos = {r for r, _ in who}
        spaces = {namespace(r) for r in repos}
        ns = namespace(next(iter(repos)))
        if len(who) == 1:
            r, d = next(iter(who))
            chain = [("n", ns), ("r", ns, r), ("t", ns, r, d)]
        elif len(repos) == 1:
            r = next(iter(repos))
            chain = [("n", ns), ("r", ns, r), ("s", ns, r)]
        elif len(spaces) == 1:
            chain = [("n", ns), ("s", ns)]
        else:
            chain = [("s",)]
        parent = ()
        top["size"] += sizes[blob]
        top["used"] = newest(top["used"], ages.get(blob))
        for key in chain:
            n = get(key, parent)
            n["size"] += sizes[blob]
            n["used"] = newest(n["used"], ages.get(blob))
            parent = key
        for r in repos:
            per_repo[r] = per_repo.get(r, 0) + sizes[blob]
    for n in nodes.values():
        n["used"] = list(n["used"]) if n["used"] else None
        n["kids"] = folded(sorted(n["kids"], key=lambda k: (-k["size"], k["name"])))
    out_ages = {}
    for (repo, digest), names in leaves.items():
        used = None
        for blob in blobs_by_digest.get(digest, {}):
            used = newest(used, ages.get(blob))
        for t in names if used else ():
            out_ages.setdefault(repo, {})[t] = list(used)
    return {"total": top["size"], "repos": per_repo, "tree": top, "ages": out_ages}


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

    def scan(self):
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
        result = analyse(tags, {d: b for d, (b, _) in cache.items()}, ages)
        disk = files = None
        if self.mount:
            disk, files = disk_total(self.mount)
        now = self.clock()
        result.update({"updated": int(now), "mount": bool(self.mount), "disk": disk, "files": files, "tags": len(tags), "blobs": len({b for v, _ in cache.values() for b in v})})
        with self.lock:
            self.latest = result
        self.state.add_usage(history_point(now, result["total"], disk, result["repos"]), now)
        return result

    def snapshot(self):
        with self.lock:
            return self.latest

    def run(self):
        while not self.stop.is_set():
            if self.state.baselined:
                try:
                    self.scan()
                except Exception as e:  # never die: try again next interval
                    log.warning("usage scan failed: %s", getattr(e, "message", e))
                if self.stop.wait(self.interval):
                    return
            elif self.stop.wait(5):
                return
