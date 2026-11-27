import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixture } from "./fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function start(args, cwd) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const output = { stdout: "", stderr: "" };
  for (const stream of ["stdout", "stderr"]) {
    child[stream].setEncoding("utf8");
    child[stream].on("data", (chunk) => (output[stream] += chunk));
  }
  return { child, output };
}

function finished(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function run(args, cwd) {
  const { child, output } = start(args, cwd);
  return finished(child).then((code) => ({ code, ...output }));
}

// Resolve once a running child prints a match, or fail if it exits or hangs.
function waitFor(child, output, pattern) {
  return new Promise((resolve, reject) => {
    const done = (err, value) => {
      clearTimeout(timer);
      child.stdout.off("data", check);
      child.off("close", onClose);
      if (err) reject(err);
      else resolve(value);
    };
    const check = () => {
      const match = output.stdout.match(pattern);
      if (match) done(null, match);
    };
    const onClose = () => done(new Error(`CLI exited before printing ${pattern}`));
    const timer = setTimeout(() => done(new Error(`Timed out waiting for ${pattern}`)), 10000);
    child.stdout.on("data", check);
    child.on("close", onClose);
    check();
  });
}

test("-v and --version print the version from package.json", async () => {
  for (const flag of ["-v", "--version"]) {
    const { code, stdout } = await run([flag], root);
    assert.equal(code, 0, flag);
    assert.equal(stdout.trim(), pkg.version, flag);
  }
});

test("-h and --help print usage and exit with code 0", async () => {
  for (const flag of ["-h", "--help"]) {
    const { code, stdout } = await run([flag], root);
    assert.equal(code, 0, flag);
    assert.match(stdout, /Usage/, flag);
    assert.match(stdout, /git-tm \[path\] \[options\]/, flag);
    assert.ok(stdout.includes(`v${pkg.version}`), flag);
  }
});

test("an unknown option prints an error and exits with code 1", async () => {
  const { code, stderr } = await run(["--unknown-option"], root);
  assert.equal(code, 1);
  assert.match(stderr, /error/);
});

test("a folder that is not a repository prints an error and exits with code 1", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "git-tm-cli-test-"));
  try {
    const { code, stderr } = await run([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /error/);
    assert.match(stderr, /Not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("-p 0 starts a server and can be stopped cleanly", async (t) => {
  const fx = makeFixture();
  let child;
  t.after(() => {
    // Never leave a server behind if an assertion fails before the stop.
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  try {
    const started = start(["-p", "0", fx.repo], root);
    child = started.child;
    const url = await waitFor(child, started.output, /http:\/\/localhost:(\d+)/);
    assert.ok(Number(url[1]) > 0);

    // This child uses piped stdin, not a TTY, so interactive raw-mode shortcuts
    // must stay disabled and the existing non-interactive hint must remain.
    await waitFor(child, started.output, /Press Ctrl\+C to stop/);
    assert.doesNotMatch(started.output.stdout, /Press o to open/);

    const stopped = new Promise((resolve) => child.once("close", (code) => resolve(code)));
    child.kill("SIGTERM");
    const code = await stopped;
    // Windows terminates the child without running its signal handlers.
    if (process.platform !== "win32") assert.equal(code, 0);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
