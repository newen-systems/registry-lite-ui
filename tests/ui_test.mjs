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

test("the map shows the largest tiles and one for the rest", () => {
  const limitKids = load("limitKids");
  const kids = [30, 20, 10, 5, 0].map((size, i) => ({ name: "k" + i, size, used: size === 5 ? [900, "atime"] : size === 10 ? [100, "mtime"] : null, kids: [] }));
  assert.deepEqual(limitKids(kids, 10).map((k) => k.name), ["k0", "k1", "k2", "k3"]); // an empty node is not drawn
  const cut = limitKids(kids, 3);
  assert.deepEqual(cut.map((k) => [k.name, k.size]), [["k0", 30], ["k1", 20], ["2 smaller", 15]]);
  assert.deepEqual(cut[2].used, [900, "atime"]); // the newest use among the tiles it hides
});

test("the chart axis ends on a round number above the data", () => {
  const niceMax = load("niceMax");
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(1.2e9), 2e9);
  assert.equal(niceMax(3.1e6), 5e6);
  assert.equal(niceMax(7e6), 1e7);
});
