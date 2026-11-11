// Pure functions of app/static/app.js, loaded from its source and run under node: node --test tests/ui_test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/static/app.js", import.meta.url), "utf8");
// A top-level function declaration (async too), up to its closing brace at the start of a line. env: the globals it calls, as stubs.
function load(name, env = {}) {
  let start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) start = src.indexOf(`\nasync function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  return new Function(...Object.keys(env), `${src.slice(start, src.indexOf("\n}\n", start) + 2)}; return ${name};`)(...Object.values(env));
}

test("tags on one digest are marked wherever they sit in the list", () => {
  const digestLinks = load("digestLinks");
  const counts = (o) => new Map(Object.entries(o));
  assert.deepEqual(digestLinks(["a", "b", "a"], counts({ a: 2, b: 1 })), ["solo", null, "solo"]); // latest and 1.x apart
  assert.deepEqual(digestLinks(["a", "a", "b"], counts({ a: 2, b: 1 })), ["start", "end", null]);
  assert.deepEqual(digestLinks(["a", "a", "a"], counts({ a: 3 })), ["start", "mid", "end"]);
  assert.deepEqual(digestLinks(["a"], counts({ a: 2 })), ["solo"]); // the other tag is filtered out or on the next page
  assert.deepEqual(digestLinks(["b"], counts({ b: 1 })), [null]);
});

test("the treemap tiles the box with areas in proportion to the sizes", () => {
  const squarify = load("squarify");
  const sizes = [600, 300, 200, 100, 50, 30, 10, 10];
  const total = sizes.reduce((a, b) => a + b, 0), w = 960, h = 420;
  const boxes = squarify(sizes, w, h);
  assert.equal(boxes.length, sizes.length);
  const eps = 1e-6;
  boxes.forEach((b, i) => {
    assert.ok(b.x >= -eps && b.y >= -eps && b.x + b.w <= w + eps && b.y + b.h <= h + eps, `tile ${i} inside the box`);
    assert.ok(Math.abs(b.w * b.h - (sizes[i] / total) * w * h) < 1e-3, `tile ${i} area in proportion`);
  });
  assert.ok(Math.abs(boxes.reduce((a, b) => a + b.w * b.h, 0) - w * h) < 1e-3, "no gaps");
  for (let i = 0; i < boxes.length; i++) { // no two tiles overlap
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x + a.w <= b.x + eps || b.x + b.w <= a.x + eps || a.y + a.h <= b.y + eps || b.y + b.h <= a.y + eps, `tiles ${i} and ${j} apart`);
    }
  }
  assert.deepEqual(squarify([5], 10, 4), [{ x: 0, y: 0, w: 10, h: 4 }]); // one tile fills the box
  assert.deepEqual(squarify([], 10, 4), []);
  assert.deepEqual(squarify([0, 0], 10, 4), [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }]); // nothing to show
  const worstRatio = Math.max(...squarify([4, 3, 2, 1], 100, 100).map((b) => Math.max(b.w / b.h, b.h / b.w)));
  assert.ok(worstRatio < 3, "tiles stay near square");
});


test("blocks under 1% become one block and no folder is lost", () => {
  const groupSmall = load("groupSmall");
  const k = (name, size, oldest) => ({ name, size, tags: 1, oldest: oldest || null, kids: [] });
  const kids = [k("big", 900), k("mid", 80), k("s1", 4, [900, "atime"]), k("s2", 3, [100, "mtime"]), k("s3", 2), k("empty", 0), k("s4", 11)];
  const out = groupSmall(kids, 1000, 0.01);
  assert.deepEqual(out.map((x) => x.name), ["big", "mid", "s4", "3 smaller items"]); // s4 (1.1%) stays, the empty one is dropped
  const rest = out[3];
  assert.deepEqual([rest.size, rest.tags, rest.oldest, rest.kind], [9, 3, [100, "mtime"], "other"]);
  assert.deepEqual(rest.names, ["s1", "s2", "s3"]);
  assert.deepEqual(groupSmall([k("a", 990), k("b", 5)], 1000, 0.01).map((x) => x.name), ["a", "b"]); // one small block is not worth a group
});

test("the map finds a folder by its path, five levels deep", () => {
  const nodeAt = load("nodeAt");
  const n = (name, kind, kids = []) => ({ name, kind, kids });
  const top = n("", "folder", [n("org", "folder", [n("team-a", "folder", [n("backend", "folder", [n("api", "repo", [n("1", "tag")])]), n("backend", "tag")])])]);
  assert.equal(nodeAt(top, ""), top);
  assert.equal(nodeAt(top, "org/team-a/backend/api").kind, "repo");
  assert.equal(nodeAt(top, "org/team-a/backend").kind, "folder"); // not the tag that has the same name
  assert.equal(nodeAt(top, "org/nope/backend"), null);
});

test("crumbs are the segment names, each linking to its own folder", () => {
  const pathCrumbs = load("pathCrumbs");
  assert.deepEqual(pathCrumbs("org/team-a/backend", "#/storage"), [
    { text: "org", href: "#/storage/org" }, { text: "team-a", href: "#/storage/org/team-a" }, { text: "backend", href: "#/storage/org/team-a/backend" }]);
  assert.deepEqual(pathCrumbs("", "#/storage"), []);
});

test("folder sizes follow every level of the map", () => {
  const pathSizes = load("pathSizes");
  const n = (name, path, kind, size, oldest, kids = []) => ({ name, path, kind, size, oldest, kids });
  const top = n("", "", "folder", 9, null, [n("org", "org", "folder", 9, [5, "mtime"], [n("team-a", "org/team-a", "folder", 9, [5, "mtime"], [
    n("api", "org/team-a/api", "repo", 9, [5, "mtime"], [{ kind: "tag", name: "1", size: 9, kids: [] }, { kind: "shared", name: "s", size: 0, kids: [] }])])])]);
  const m = pathSizes(top);
  assert.deepEqual([...m.keys()], ["org", "org/team-a", "org/team-a/api"]); // tags and shared items have no path of their own
  assert.deepEqual([m.get("org/team-a").size, m.get("org/team-a").oldest], [9, [5, "mtime"]]);
});

test("deleting tags frees the layers every user of which goes", () => {
  const freedBytes = load("freedBytes");
  // blob 0 only 'a' holds, blob 1 is used by a and b, blob 2 by b and another repository, blob 3 only 'c'
  const detail = { blobs: [[10, 1], [20, 2], [30, 2], [40, 1]], tags: [
    { tag: "a", digest: "da", blobs: [0, 1] }, { tag: "a2", digest: "da", blobs: [] },
    { tag: "b", digest: "db", blobs: [1, 2] }, { tag: "c", digest: "dc", blobs: [3] } ] };
  assert.deepEqual(freedBytes(detail, new Set(["a"])), { bytes: 10, extra: 1, digests: 1 }); // a2 shares a's digest and goes too
  assert.deepEqual(freedBytes(detail, new Set(["a", "b"])), { bytes: 10 + 20, extra: 1, digests: 2 }); // blob 1 goes now, blob 2 is still used elsewhere
  assert.deepEqual(freedBytes(detail, new Set(["a", "a2", "c"])), { bytes: 50, extra: 0, digests: 2 });
  assert.deepEqual(freedBytes(detail, new Set()), { bytes: 0, extra: 0, digests: 0 });
});

test("all but the newest N keeps whole images, never half of a digest", () => {
  const allButNewest = load("allButNewest");
  const rows = [
    { tag: "1.0", digest: "d1", pushed: 100 }, { tag: "latest", digest: "d3", pushed: 50 }, { tag: "1.2", digest: "d3", pushed: 300 },
    { tag: "1.1", digest: "d2", pushed: 200 }, { tag: "old", digest: "d0", pushed: 10 }, { tag: "old2", digest: "d0" },
  ];
  assert.deepEqual([...allButNewest(rows, 2)].sort(), ["1.0", "old", "old2"]); // d3 (newest at 300) and d2 stay with every tag, d1 and d0 go
  assert.deepEqual([...allButNewest(rows, 10)], []);
});

test("quick select: the placeholder changes nothing and a day count picks only what is older", () => {
  const src2 = (name) => load(name);
  const allButNewest = src2("allButNewest");
  const quickSelect = new Function("allButNewest", `${src.slice(src.indexOf("\nfunction quickSelect("), src.indexOf("\n}\n", src.indexOf("\nfunction quickSelect(")) + 2)}; return quickSelect;`)(allButNewest);
  const now = 1_000_000_000, day = 86400;
  const rows = [
    { tag: "new", digest: "d1", used: [now - 5 * day, "atime"], pushed: now },
    { tag: "mid", digest: "d2", used: [now - 100 * day, "atime"], pushed: now - 1 },
    { tag: "old", digest: "d3", used: [now - 400 * day, "mtime"], pushed: now - 2 },
    { tag: "none", digest: "d4", used: null, pushed: now - 3 },
  ];
  assert.equal(quickSelect("", rows, now), null); // the placeholder is not a choice, and must not select everything
  assert.equal(quickSelect("0", rows, now), null);
  assert.equal(quickSelect("abc", rows, now), null);
  assert.deepEqual([...quickSelect("180", rows, now)], ["old"]);
  assert.deepEqual([...quickSelect("90", rows, now)].sort(), ["mid", "old"]);
  assert.deepEqual([...quickSelect("180", rows.map((r) => ({ ...r, used: [now, "atime"] })), now)], []); // everything used today: nothing is stale
  assert.deepEqual([...quickSelect("none", rows, now)], []);
});

test("grouping never hides a whole folder and keeps the blocks largest first", () => {
  const groupSmall = load("groupSmall");
  const k = (name, size) => ({ name, size, tags: 1, oldest: null, kids: [] });
  const sixty = Array.from({ length: 60 }, (_, i) => k("r" + i, 16)); // each 1.6% of 1000: all small
  assert.equal(groupSmall(sixty, 1000, 0.02).length, 60); // nothing to group them under, so they all stay
  const out = groupSmall([k("a", 100), ...Array.from({ length: 40 }, (_, i) => k("s" + i, 15)), k("b", 120)], 1000, 0.02);
  assert.deepEqual(out.map((x) => x.name), ["40 smaller items", "b", "a"]); // the group is 600: it sorts first
});

function loadWith(name, deps) { // a top-level function that calls other top-level functions: they are passed in by name
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  const body = src.slice(start, src.indexOf("\n}\n", start) + 2);
  return new Function(...Object.keys(deps), `${body}; return ${name};`)(...Object.values(deps));
}
class FakeNav { // location.hash and the history stack of a browser: a hash assignment adds an entry, back() steps to the one before
  constructor(first) { this.stack = [first]; this.at = 0; }
  get hash() { return this.stack[this.at]; }
  set hash(v) { this.stack.splice(this.at + 1); this.stack.push(v); this.at++; }
  back() { this.at--; }
}

test("Back returns to the level just left, however it was reached", () => {
  const pathCrumbs = load("pathCrumbs");
  const nav = new FakeNav("#/storage");
  const crumbs = pathCrumbs("org/team-a", "#/storage");
  assert.deepEqual(crumbs.map((x) => x.text), ["org", "team-a"]); // the crumbs are plain links to each level
  nav.hash = "#/storage/org"; // a click on a block, or on a crumb, is a hash assignment: one history entry each
  nav.hash = crumbs[1].href;
  assert.equal(nav.hash, "#/storage/org/team-a");
  nav.back();
  assert.equal(nav.hash, "#/storage/org");
  nav.hash = crumbs[0].href; // the crumb for the level already shown still adds an entry, and Back leaves it
  nav.back();
  assert.equal(nav.hash, "#/storage/org");
});

test("no navigation replaces the history entry, so Back always steps one level", () => {
  assert.ok(!/history\.replaceState|location\.replace\(/.test(src));
});

test("sizing by total keeps a block for a repository whose layers are all shared", () => {
  const groupSmall = load("groupSmall");
  const k = (name, size, held) => ({ name, size, held, tags: 1, oldest: null, kids: [] });
  const kids = [k("api", 50, 60), k("team-b", 0, 55), k("maven", 0, 40)];
  assert.deepEqual(groupSmall(kids, 155, 0.02, (x) => x.held).map((x) => x.name), ["api", "team-b", "maven"]);
  assert.deepEqual(groupSmall(kids, 50, 0.02).map((x) => x.name), ["api"]); // by frees they have nothing to draw
});

test("the summary line and the tree give the same figure for a folder, under Total and under Frees", () => {
  const figureOf = load("figureOf"), pathSizes = load("pathSizes");
  const blockWeight = load("blockWeight"), mapKids = load("mapKids");
  const n = (name, path, kind, size, held, kids = []) => ({ name, path, kind, size, held, oldest: null, kids });
  const k = (name, size, held, kind = "folder") => ({ ...n(name, "org/" + name, kind, size, held), tags: 1 });
  const org = n("org", "org", "folder", 100, 369, [k("team-a", 100, 150), k("team-b", 0, 280), k("shared", 50, 50, "shared")]);
  const top = n("", "", "folder", 100, 369, [org]);
  const tree = pathSizes(top);
  for (const [by, want] of [["total", 369], ["frees", 100]]) {
    assert.equal(figureOf(org, by), want); // the line above the map
    assert.equal(figureOf(tree.get("org"), by), want); // the tree row
  }
  const drawn = mapKids(org, "total").reduce((a, x) => a + blockWeight("total")(x), 0);
  assert.ok(drawn >= figureOf(org, "total")); // 430 against 369: a layer shared by two blocks is in both
  assert.equal(mapKids(org, "total").length, 2); // the shared block is not drawn under Total
});


test("a slow action shows its busy text until it ends, then clears it or shows the error", async () => {
  const seen = [], banner = (t, err) => seen.push(err ? `ERR ${t}` : t);
  const run = load("run", { banner });
  await run(async () => seen.push("job"), async () => seen.push("done"), "Deleting 3 tags...");
  assert.deepEqual(seen, ["Deleting 3 tags...", "job", "", "done"]);
  seen.length = 0;
  await run(async () => { throw new Error("registry said 500"); }, async () => seen.push("done"), "Deleting 3 tags...");
  assert.deepEqual(seen, ["Deleting 3 tags...", "ERR registry said 500"]);
});

test("moving tags to the Bin from the Storage tab clears that tab's selection and shows the results", async () => {
  const states = new Map([["rstor:demo/app", { picked: new Set(["v1", "v2", "v3"]) }]]); // the Tags view was never opened
  const stateOf = (id) => { if (!states.has(id)) states.set(id, {}); return states.get(id); };
  const calls = [];
  const deleteTags = load("deleteTags", {
    confirmDeleteTags: async () => ({ children: false }), stateOf, cfg: { maxBatch: 100 }, batches: load("batches"), banner: (t) => calls.push(`banner:${t}`), goneVerb: (w) => `Moving ${w} to the Bin...`,
    plural: (n, w) => `${n} ${w}s`, api: async () => ({ results: [{ tag: "v1", status: "deleted" }, { tag: "v2", status: "deleted" }, { tag: "v3", status: "failed" }] }),
    touch: async () => calls.push("touch"), deleteResults: async () => calls.push("results"), renderPane: async () => calls.push("render"), $: () => ({ querySelector: () => null }),
  });
  await deleteTags({ path: "demo/app" }, ["v1", "v2", "v3"].map((tag) => ({ tag })));
  assert.deepEqual([...states.get("rstor:demo/app").picked], ["v3"]); // the failed one stays picked
  assert.deepEqual(calls, ["banner:Moving 3 tags to the Bin...", "banner:", "touch", "results", "render"]); // touch refreshes the Bin count
});

test("a bulk delete of more than the cap goes in calls of at most the cap, indexes first, a digest never split", () => {
  const batches = load("batches");
  const tags = Array.from({ length: 250 }, (_, i) => ({ tag: "v" + i, digest: "d" + Math.floor(i / 2) })); // two tags per digest
  tags.push({ tag: "idx", digest: "di", index: true });
  const out = batches(tags, 100);
  assert.ok(out.every((b) => b.length <= 100), "no call over the cap");
  assert.equal(out.flat().length, 251, "every tag once");
  assert.equal(out[0][0].tag, "idx", "the index goes first");
  for (const b of out) for (const t of b) assert.ok(b.some((o) => o !== t && o.digest === t.digest) || t.digest === "di", `${t.tag} kept with its digest`);
  const big = batches(Array.from({ length: 150 }, (_, i) => ({ tag: "t" + i, digest: "same" })), 100); // one digest over the cap is split
  assert.deepEqual(big.map((b) => b.length), [100, 50]);
});

test("References lists every other tag on the digest, here and in other repositories, never the tag itself", () => {
  const el = (tag, props, ...kids) => ({ tag, ...props, kids });
  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const repoOf = (ref) => ref.slice(0, ref.lastIndexOf(":"));
  const refs = load("referencesSection", { el, plural, repoOf });
  const [, p, chips] = refs("a/app", { kind: "tag", tag: "v1" }, { refs: ["a/app:latest", "a/app:v1", "b/copy:prod"], more: 0 });
  assert.deepEqual(chips.kids.map((k) => k.href), ["#/repo/a/app:latest", "#/repo/b/copy:prod"]);
  assert.match(p.textContent, /^2 other tags in 2 repositories point at this digest/);
  const [, alone] = refs("a/app", { kind: "tag", tag: "v1" }, { refs: ["a/app:v1"], more: 0 });
  assert.match(alone.textContent, /^No other tag/);
  assert.deepEqual(refs("a/app", { kind: "tag", tag: "v1" }, null), []); // an older server
});
