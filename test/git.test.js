import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { openRepo, webUrl, WORKTREE, GitError } from "../src/git.js";
import { makeFixture } from "./fixture.js";

let fx;
let repo;

before(async () => {
  fx = makeFixture();
  repo = await openRepo(path.join(fx.repo, "src")); // works from a subdirectory
});

after(() => rmSync(fx.dir, { recursive: true, force: true }));

test("opens the repository root from a subdirectory", () => {
  assert.equal(repo.root, fx.repo);
  assert.equal(repo.bare, false);
});

test("rejects directories that are not repositories", async () => {
  await assert.rejects(openRepo(fx.dir), /Not a git repository/);
});

test("info lists branches, tags, HEAD and working tree changes", async () => {
  const info = await repo.info();
  assert.equal(info.branch, "main");
  assert.deepEqual(info.branches.map((b) => b.name).sort(), ["feature", "main"]);
  assert.deepEqual(info.tags.map((t) => t.name).sort(), ["v0.1", "v1.0"]);
  assert.equal(info.tags.find((t) => t.name === "v1.0").annotated, true);
  assert.equal(info.changes, 2);
});

test("log returns commits newest first with parents and decorations", async () => {
  const { commits, graph, done } = await repo.log({});
  assert.equal(graph, true);
  assert.equal(done, true);
  assert.equal(commits.length, 7);
  assert.equal(commits[0].subject, "Add binary <b>file</b>");
  assert.ok(commits[0].refs.some((r) => r.type === "head" && r.name === "main"));
  assert.ok(commits[0].refs.some((r) => r.type === "tag" && r.name === "v1.0"));
  const merge = commits.find((c) => c.subject.startsWith("Merge"));
  assert.equal(merge.parents.length, 2);
});

test("log pages with skip/limit", async () => {
  const a = await repo.log({ limit: 3 });
  const b = await repo.log({ skip: 3, limit: 3 });
  assert.equal(a.commits.length, 3);
  assert.equal(a.done, false);
  assert.notEqual(a.commits[0].hash, b.commits[0].hash);
});

test("log filters by message, author and pickaxe", async () => {
  assert.deepEqual((await repo.log({ message: "RENAME" })).commits.map((c) => c.subject), ["refactor: rename a.txt"]);
  const byGrace = await repo.log({ author: "grace" });
  assert.equal(byGrace.commits.length, 1);
  assert.equal(byGrace.graph, false);
  const pick = await repo.log({ code: "there" });
  assert.deepEqual(pick.commits.map((c) => c.subject), ["Add greeting"]);
});

test("file history follows renames", async () => {
  const { commits } = await repo.log({ path: "src/greeting.txt", follow: true });
  assert.deepEqual(commits.map((c) => c.subject), ["refactor: rename a.txt", "Add greeting", "Initial commit"]);
});

test("files reports renames, binaries and line counts", async () => {
  const { commits } = await repo.log({});
  const rename = commits.find((c) => c.subject.startsWith("refactor"));
  const res = await repo.files(rename.parents[0], rename.hash);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].status, "R");
  assert.equal(res.files[0].oldPath, "src/a.txt");
  assert.equal(res.files[0].path, "src/greeting.txt");

  const bin = commits[0];
  const binRes = await repo.files(bin.parents[0], bin.hash);
  assert.equal(binRes.files[0].binary, true);

  const root = commits[commits.length - 1];
  const rootRes = await repo.files("", root.hash);
  assert.equal(rootRes.files.length, 2);
  assert.equal(rootRes.additions, 3);
});

test("working tree comparison includes untracked files", async () => {
  const res = await repo.files("HEAD", WORKTREE);
  const byPath = Object.fromEntries(res.files.map((f) => [f.path, f]));
  assert.equal(byPath["src/greeting.txt"].status, "M");
  assert.equal(byPath["untracked.txt"].status, "?");
  const patch = await repo.patch("HEAD", WORKTREE, "untracked.txt");
  assert.match(patch.patch, /^\+new$/m);
});

test("patch returns a unified diff for one file", async () => {
  const { patch } = await repo.patch("v0.1~1", "v0.1", "src/a.txt");
  assert.match(patch, /^@@ -1,2 \+1,3 @@/m);
  assert.match(patch, /^\+there$/m);
});

const subjects = (list) => list.map((c) => c.subject);

test("travelling forward applies commits and steps along first parents", async () => {
  const r = await repo.range("v0.1", "main");
  assert.equal(r.addedCount, 5);
  assert.equal(r.removedCount, 0);
  assert.equal(r.added.length, 5);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(subjects(r.path), ["docs: expand readme", "Merge branch 'feature'", "Add binary <b>file</b>"]);
  assert.equal(r.mergeBase, (await repo.resolve("v0.1")));
});

test("travelling back undoes commits and ends at the older commit", async () => {
  const r = await repo.range("main", "v0.1");
  assert.equal(r.addedCount, 0);
  assert.equal(r.removedCount, 5);
  assert.deepEqual(subjects(r.path), ["Merge branch 'feature'", "docs: expand readme", "Add greeting"]);
});

test("travelling across branches goes back to the common ancestor, then forward", async () => {
  const r = await repo.range("feature", "main~2");
  assert.equal(r.removedCount, 2);
  assert.equal(r.addedCount, 1);
  assert.deepEqual(subjects(r.path), ["feat: add feature file", "Add greeting", "docs: expand readme"]);
});

test("travelling to the same commit or the working tree has no path", async () => {
  assert.deepEqual((await repo.range("main", "main")).path, []);
  assert.deepEqual((await repo.range("main", WORKTREE)).path, []);
});

test("tree, blob and blame read historical content", async () => {
  const tree = await repo.tree("v1.0");
  assert.deepEqual(tree.entries.map((e) => e.name), ["src", "data.bin", "README.md"]);
  const blob = await repo.blob("v0.1", "src/a.txt");
  assert.equal(blob.content, "hello\nthere\nworld\n");
  assert.equal((await repo.blob("v1.0", "data.bin")).binary, true);
  const blame = await repo.blame("v1.0", "src/greeting.txt");
  assert.equal(blame.lines.length, 3);
  assert.equal(blame.commits[blame.lines[1]].subject, "Add greeting");
});

test("contains lists refs that include a commit", async () => {
  const res = await repo.containedIn("v0.1");
  assert.deepEqual(res.branches.sort(), ["feature", "main"]);
  assert.deepEqual(res.tags.sort(), ["v0.1", "v1.0"]);
});

test("insights aggregates authors and activity", async () => {
  const ins = await repo.insights();
  assert.equal(ins.total, 6); // merges excluded
  assert.equal(ins.contributorCount, 2);
  assert.equal(ins.contributors[0].name, "Ada Lovelace");
});

test("user input can never become a git option", async () => {
  for (const bad of ["--output=/tmp/pwned", "-p", "a b", "x\0y", ""]) {
    await assert.rejects(repo.resolve(bad), GitError);
  }
  await assert.rejects(repo.log({ ref: "--all" }), GitError);
  await assert.rejects(repo.files("--output=/tmp/x", "HEAD"), GitError);
});

test("webUrl converts remote URLs", () => {
  assert.equal(webUrl("git@github.com:nandhu-44/Git-Time-Machine.git"), "https://github.com/nandhu-44/Git-Time-Machine");
  assert.equal(webUrl("https://gitlab.com/group/sub/repo.git"), "https://gitlab.com/group/sub/repo");
  assert.equal(webUrl("ssh://git@example.com:2222/a/b.git"), "https://example.com/a/b");
  assert.equal(webUrl("https://user:token@github.com/a/b"), "https://github.com/a/b");
  assert.equal(webUrl("/local/path"), null);
});

test("local branches with slashes are not mistaken for remote branches", async () => {
  fx.git("branch", "topic/x", "v0.1");
  const { commits } = await repo.log({});
  const tagged = commits.find((c) => c.refs.some((r) => r.name === "v0.1"));
  assert.deepEqual(
    tagged.refs.map((r) => [r.type, r.name]).sort(),
    [["branch", "topic/x"], ["tag", "v0.1"]],
  );
});
