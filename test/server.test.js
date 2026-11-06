import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { rmSync } from "node:fs";
import { openRepo } from "../src/git.js";
import { createServer, listen } from "../src/server.js";
import { makeFixture } from "./fixture.js";

let fx;
let server;
let port;

before(async () => {
  fx = makeFixture();
  server = createServer(await openRepo(fx.repo), { avatars: true });
  port = await listen(server, 0, "127.0.0.1");
});

after(() => {
  server.close();
  rmSync(fx.dir, { recursive: true, force: true });
});

function request(path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves the UI with a strict content security policy", async () => {
  const res = await request("/");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  assert.match(res.body, /Git Time Machine/);
});

test("API returns JSON", async () => {
  const res = await request("/api/log?limit=2");
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.commits.length, 2);
  assert.ok(data.avatars["1234+grace@users.noreply.github.com"].startsWith("https://avatars.githubusercontent.com/u/1234"));
});

test("unknown revisions are 404, bad ones 400", async () => {
  assert.equal((await request("/api/commit?rev=nope")).status, 404);
  assert.equal((await request("/api/commit?rev=--output%3D%2Ftmp%2Fx")).status, 400);
  assert.equal((await request("/api/commit")).status, 400);
});

test("rejects foreign Host headers (DNS rebinding)", async () => {
  const res = await request("/api/repo", { headers: { host: "evil.example:80" } });
  assert.equal(res.status, 421);
});

test("POST endpoints require the custom header", async () => {
  const res = await request("/api/fetch", { method: "POST" });
  assert.equal(res.status, 403);
});

test("static files cannot escape the public directory", async () => {
  for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fgit.js"]) {
    const res = await request(p);
    assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
  }
});

test("listen moves to the next free port", async () => {
  const other = createServer(await openRepo(fx.repo));
  const p = await listen(other, port, "127.0.0.1");
  assert.ok(p > port);
  other.close();
});
