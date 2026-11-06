// Builds a small repository with branches, merges, tags, a rename, a binary
// file and uncommitted changes. Returns its path.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "git-tm-test-"));
  let t = 1700000000;
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(dir, ".no-global"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Ada Lovelace",
    GIT_AUTHOR_EMAIL: "ada@example.com",
    GIT_COMMITTER_NAME: "Ada Lovelace",
    GIT_COMMITTER_EMAIL: "ada@example.com",
  };
  const repo = path.join(dir, "repo");
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const commit = (...args) => {
    t += 86400;
    env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = `@${t} +0000`;
    git("commit", "-q", ...args);
  };
  const write = (p, s) => {
    mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
    writeFileSync(path.join(repo, p), s);
  };

  git("init", "-q", "-b", "main");
  write("src/a.txt", "hello\nworld\n");
  write("README.md", "# Demo\n");
  git("add", ".");
  commit("-m", "Initial commit");
  write("src/a.txt", "hello\nthere\nworld\n");
  git("add", ".");
  commit("-m", "Add greeting", "-m", "Body line.");
  git("tag", "v0.1");
  git("checkout", "-q", "-b", "feature");
  write("src/feat.txt", "feature\n");
  git("add", ".");
  commit("-m", "feat: add feature file");
  git("mv", "src/a.txt", "src/greeting.txt");
  commit("-m", "refactor: rename a.txt");
  git("checkout", "-q", "main");
  write("README.md", "# Demo\n\nDocs.\n");
  git("add", ".");
  commit("-m", "docs: expand readme");
  t += 86400;
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = `@${t} +0000`;
  git("merge", "-q", "--no-ff", "feature", "-m", "Merge branch 'feature'");
  env.GIT_AUTHOR_NAME = "Grace Hopper";
  env.GIT_AUTHOR_EMAIL = "1234+grace@users.noreply.github.com";
  writeFileSync(path.join(repo, "data.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  git("add", ".");
  commit("-m", "Add binary <b>file</b>");
  git("tag", "-a", "v1.0", "-m", "Release 1.0");
  appendFileSync(path.join(repo, "src/greeting.txt"), "dirty\n");
  write("untracked.txt", "new\n");
  return { dir, repo, git };
}
