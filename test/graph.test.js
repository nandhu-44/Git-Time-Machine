import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayout, layout, rowSvg } from "../src/public/js/graph.js";

const c = (hash, ...parents) => ({ hash, parents });

test("linear history stays in one lane", () => {
  const commits = [c("c", "b"), c("b", "a"), c("a")];
  layout(createLayout(), commits);
  assert.deepEqual(commits.map((x) => x.g.col), [0, 0, 0]);
  assert.deepEqual(commits.map((x) => x.g.width), [1, 1, 1]);
  assert.deepEqual(commits[2].g.down, []);
});

test("branch and merge use a second lane that is freed afterwards", () => {
  // m merges f into b; f and b both come from a.
  const commits = [c("m", "b", "f"), c("f", "a"), c("b", "a"), c("a")];
  layout(createLayout(), commits);
  const [m, f, b, a] = commits;
  assert.equal(m.g.col, 0);
  assert.deepEqual(m.g.down, [0, 1]);
  assert.equal(f.g.col, 1);
  assert.deepEqual(f.g.pass, [0]);
  assert.equal(b.g.col, 0);
  // f's lane (waiting for a) folds back into the mainline below b.
  assert.deepEqual(b.g.shift, [[1, 0]]);
  assert.deepEqual(b.g.pass, []);
  assert.equal(a.g.col, 0);
  assert.deepEqual(a.g.up, [0]);
  assert.equal(a.g.width, 1);
});

test("a merge whose parent sits to the left joins that lane", () => {
  // x (col 1) has parent b, which is already expected in col 0.
  const commits = [c("y", "b"), c("x", "b"), c("b")];
  layout(createLayout(), commits);
  const [, x, b] = commits;
  assert.equal(x.g.col, 1);
  assert.deepEqual(x.g.down, [0]);
  assert.deepEqual(b.g.up, [0]);
});

test("layout continues across pages", () => {
  const state = createLayout();
  const p1 = [c("d", "c"), c("x", "b")];
  const p2 = [c("c", "b"), c("b")];
  layout(state, p1);
  layout(state, p2);
  assert.equal(p1[1].g.col, 1);
  assert.deepEqual(p2[0].g.shift, [[1, 0]]);
  assert.equal(p2[1].g.col, 0);
  assert.equal(state.lanes.length, 0);
});

test("every lane is freed by the end of a complete history", () => {
  // Octopus-ish shape with two merges and a long-lived side branch.
  const commits = [
    c("m2", "m1", "s2"),
    c("s2", "s1"),
    c("m1", "a3", "t1"),
    c("t1", "a2"),
    c("a3", "a2"),
    c("s1", "a1"),
    c("a2", "a1"),
    c("a1"),
  ];
  const state = layout(createLayout(), commits);
  assert.equal(state.lanes.length, 0);
  assert.ok(commits.every((x) => x.g.col < 3));
});

test("rowSvg renders a node and lanes", () => {
  const commits = [c("m", "b", "f"), c("f", "a")];
  layout(createLayout(), commits);
  const svg = rowSvg(commits[0].g, { height: 34, maxLanes: 10, merge: true });
  assert.match(svg, /^<svg class="graph"/);
  assert.match(svg, /<circle/);
});
