import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Imports by package name resolve through package.json "exports".
import * as api from "git-tm";
import * as git from "git-tm/git";
import * as server from "git-tm/server";
import * as graph from "git-tm/graph";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the main entry exposes the public API", () => {
  for (const name of ["openRepo", "git", "GitError", "webUrl", "createServer", "listen", "createLayout", "layout"]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.equal(api.WORKTREE, "WORKTREE");
  assert.equal(api.openRepo, git.openRepo);
  assert.equal(api.createServer, server.createServer);
  assert.equal(api.layout, graph.layout);
});

test("every export has a type declaration file", () => {
  for (const [sub, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string") continue;
    assert.ok(existsSync(new URL("../" + target.types, import.meta.url)), `${sub} types`);
    assert.ok(existsSync(new URL("../" + target.default, import.meta.url)), `${sub} code`);
    assert.ok(target.default.startsWith("./src/") && target.types.startsWith("./src/"), `${sub} is published`);
  }
});
