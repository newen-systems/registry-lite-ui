// Pure functions of app/static/app.js, loaded from its source and run under node: node --test tests/ui_test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/static/app.js", import.meta.url), "utf8");
function load(name) { // a top-level function declaration, up to its closing brace at the start of a line
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  return new Function(`${src.slice(start, src.indexOf("\n}\n", start) + 2)}; return ${name};`)();
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

test("the map shows the largest blocks and one for the rest", () => {
  const limitKids = load("limitKids");
  const kids = [30, 20, 10, 5, 0].map((size, i) => ({ name: "k" + i, size, tags: 1, oldest: size === 5 ? [900, "atime"] : size === 10 ? [100, "mtime"] : null, kids: [] }));
  assert.deepEqual(limitKids(kids, 10).map((k) => k.name), ["k0", "k1", "k2", "k3"]); // an empty node is not drawn
  const cut = limitKids(kids, 3);
  assert.deepEqual(cut.map((k) => [k.name, k.size]), [["k0", 30], ["k1", 20], ["2 smaller", 15]]);
  assert.deepEqual([cut[2].oldest, cut[2].tags], [[100, "mtime"], 2]); // the stalest of the blocks it hides
});

test("folder sizes add the repositories under them", () => {
  const pathSizes = load("pathSizes");
  const repo = (name, size, oldest) => ({ name, repo: name, size, oldest, kids: [] });
  const top = { kids: [
    { name: "ml", ns: "ml", size: 400, kids: [repo("ml/a", 100, [50, "atime"]), repo("ml/sub/b", 200, [20, "mtime"]), { name: "shared by repositories of ml", size: 100, oldest: [10, "mtime"], kids: [] }] },
    { name: "(top level)", ns: "", size: 7, kids: [repo("solo", 7, null)] },
    { name: "shared by namespaces", size: 40, kids: [] },
  ] };
  const m = pathSizes(top);
  assert.deepEqual(m.get("ml"), { size: 400, oldest: [10, "mtime"] }); // two repositories and the layers shared inside it
  assert.deepEqual(m.get("ml/sub"), { size: 200, oldest: [20, "mtime"] });
  assert.deepEqual(m.get("ml/a"), { size: 100, oldest: [50, "atime"] });
  assert.deepEqual(m.get("solo"), { size: 7, oldest: null });
  assert.deepEqual([...m.keys()].sort(), ["ml", "ml/a", "ml/sub", "ml/sub/b", "solo"]); // the strip shared by namespaces has no path
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
