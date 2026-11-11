"""The recycle bin. A delete records the manifests it removes in the state file first, so Restore can push the same bytes back to
the tag. The registry keeps the blobs until garbage collection, so a restore works for as long as none has run."""
import base64
import binascii
import secrets
import time

import registry as R
import usage as U

MAX_ENTRIES = 1000  # entries kept, the oldest go first
MAX_MANIFESTS = 64  # manifests stored with one entry: the tag's own and its index children


def encode(data):
    return base64.b64encode(data).decode()


def decode(text):
    return base64.b64decode(text, validate=True)


def collect(read, digest, depth=0):
    """{digest: (bytes, media type)} for a manifest and its index children, as far as they can be read."""
    try:
        data, mtype = read(digest)
    except R.RegistryError:
        return {}
    out = {digest: (data, mtype)}
    if depth < R.MAX_DEPTH:
        try:
            kids = R.children(data, mtype)
        except R.RegistryError:
            kids = []
        for kid in kids:
            if kid not in out:
                out.update(collect(read, kid, depth + 1))
            if len(out) > MAX_MANIFESTS:
                break
    return out


def manifests_shape(m):
    def decodable(text):
        try:
            decode(text)
            return True
        except (binascii.Error, ValueError):
            return False
    return (isinstance(m, dict) and all(isinstance(k, str) and R.DIGEST_RE.fullmatch(k) and isinstance(v, dict) and isinstance(v.get("type"), str)
                                        and isinstance(v.get("b64"), str) and decodable(v["b64"]) for k, v in m.items()))


def entry_shape(e, stored):
    """The fields an entry must have to be restored, checked when the state file is read back. stored: the manifests kept beside the entries."""
    return (isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("repo"), str) and R.valid_repo(e["repo"])
            and isinstance(e.get("tag"), str) and R.TAG_RE.fullmatch(e["tag"]) and isinstance(e.get("type"), str) and isinstance(e.get("digest"), str)
            and R.DIGEST_RE.fullmatch(e["digest"]) and isinstance(e.get("t"), (int, float)) and isinstance(e.get("size"), int)
            and isinstance(e.get("kids"), list) and all(isinstance(k, str) for k in e["kids"]) and all(d in stored for d in [e["digest"], *e["kids"]]))


def expired(entries, now, days):
    """Entries still inside the retention, oldest first, and at most MAX_ENTRIES."""
    keep = [e for e in entries if now - e["t"] < days * 86400]
    return keep[-MAX_ENTRIES:]


def blobs_needed(manifests):
    """Every config and layer digest the stored image manifests point at, which Restore checks are still in the registry."""
    need = []
    for m in manifests.values():
        if m["type"] in R.IMAGE_TYPES:
            for d in R.blobs(decode(m["b64"])):
                if d not in need:
                    need.append(d)
    return need


def view(e, days):
    return {"id": e["id"], "repo": e["repo"], "tag": e["tag"], "digest": e["digest"], "type": e["type"], "size": e["size"], "t": int(e["t"]),
            "expires": int(e["t"] + days * 86400), "manifests": 1 + len(e["kids"])}


class Bin:
    """The bin over State's bin entries and the manifests stored once per digest beside them. days is UI_BIN_DAYS, never 0 here:
    with 0 there is no Bin."""
    def __init__(self, state, days, clock=time.time):
        self.state, self.days, self.clock = state, days, clock
        state.bin_days = days

    def record(self, c, repo, digest, data, mtype, tags):
        """Store what a delete of digest is about to remove, one entry per tag on it. Returns the ids. Returns [] and stores nothing for
        an untagged digest, and for an index with a child manifest that cannot be read or kept (it could not be restored)."""
        def read(d):
            if d == digest:
                return data, mtype
            body, kind, _ = c.manifest(repo, d)
            return body, kind
        stored = collect(read, digest)
        if digest not in stored or not tags:
            return []
        for body, kind in stored.values():
            if kind in R.INDEX_TYPES and not all(k in stored for k in R.children(body, kind)):
                return []
        blobs, _ = U.blobs_of(lambda d: stored[d][0], digest)
        size = sum(s for b, s in blobs.items() if b not in stored)  # config and layers, the manifests themselves are small
        now = self.clock()
        kids = [d for d in stored if d != digest]
        with self.state.cond:  # the tag's own times, so a restored tag goes back to its place in the lists instead of looking new
            times = {t: self.state.tags.get(f"{repo}:{t}", {}) for t in tags}
        entries = [{"id": secrets.token_hex(6), "repo": repo, "tag": t, "digest": digest, "type": mtype, "size": size, "t": now, "kids": kids,
                    "changed": times[t].get("changed"), "first": times[t].get("first")} for t in sorted(set(tags))]
        self.state.bin_add(entries, {d: {"type": t, "b64": encode(b)} for d, (b, t) in stored.items()}, now)
        return [e["id"] for e in entries]

    def discard(self, ids):
        self.state.bin_remove(set(ids))

    def list(self):
        return [view(e, self.days) for e in reversed(self.state.bin_entries(self.clock()))]

    def find(self, id_):
        for e in self.state.bin_entries(self.clock()):
            if e["id"] == id_:
                return e
        raise R.RegistryError(404, "that entry is not in the bin (already restored, deleted or expired)")

    def check_tag(self, c, repo, tag, digest):
        """409 when the tag now points at another digest, which a restore would overwrite."""
        try:
            now_digest = c.manifest(repo, tag, head=True)[2]
        except R.RegistryError as err:
            if err.status != 404:
                raise
            return
        if now_digest != digest:
            raise R.RegistryError(409, f"cannot restore: {repo}:{tag} now points at {now_digest[:19]}. Delete or retag it first.")

    def restore(self, c, id_):
        """Push the stored manifests back: children by digest, then the tag. Fails clearly, changing nothing, when a blob is gone
        (garbage collection ran) or the tag now points at a different digest."""
        e = self.find(id_)
        repo, tag, digest = e["repo"], e["tag"], e["digest"]
        manifests = self.state.bin_manifests(e)
        missing = []
        for d in blobs_needed(manifests):
            with c.open("HEAD", f"/v2/{repo}/blobs/{d}") as r:
                if r.status == 404:
                    missing.append(d)
                elif r.status != 200:
                    raise R.RegistryError(502, f"registry said {r.status} when checking blob {d[:19]}")
        if missing:
            more = f" and {len(missing) - 1} more" if len(missing) > 1 else ""
            raise R.RegistryError(409, f"cannot restore: garbage collection already removed {plural(len(missing), 'blob')} of this image ({missing[0][:19]}{more}).")
        self.check_tag(c, repo, tag, digest)
        for d, m in manifests.items():
            if d != digest:
                c.call("PUT", f"/v2/{repo}/manifests/{d}", {"Content-Type": m["type"]}, decode(m["b64"]), ok=(201,))
        self.check_tag(c, repo, tag, digest)  # again, closest to the write: a push in between is not overwritten (the registry has no conditional PUT, so a gap remains)
        root = manifests[digest]
        c.call("PUT", f"/v2/{repo}/manifests/{tag}", {"Content-Type": root["type"]}, decode(root["b64"]), ok=(201,))
        self.state.mark_restored(f"{repo}:{tag}", digest, e.get("changed"), e.get("first"))
        self.state.bin_remove({id_})
        return {"repo": repo, "tag": tag, "digest": digest}

    def purge(self, id_):
        self.find(id_)
        self.state.bin_remove({id_})

    def empty(self):
        return self.state.bin_remove(None)


def plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")
