#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { openRepo } from "./git.js";
import { createServer, listen } from "./server.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  cyan: paint("36"),
  accent: (s) => (useColor ? `\x1b[38;2;240;81;51m${s}\x1b[0m` : String(s)),
};

const HELP = `
${c.accent(c.bold("git-tm"))} ${c.dim(`v${pkg.version}`)}  Explore a repository's history in your browser

${c.bold("Usage")}
  git-tm [path] [options]
  git tm [path] [options]    ${c.dim("same thing, as a Git subcommand (use -h for help)")}

${c.bold("Options")}
  -p, --port <number>   Port to listen on ${c.dim("(default 7890, next free port is used if busy)")}
      --host <address>  Interface to bind ${c.dim("(default 127.0.0.1)")}
  -o, --open            Open the browser once the server is running
      --no-avatars      Do not load author avatars from GitHub / Gravatar
  -v, --version         Print the version
  -h, --help            Print this help

${c.bold("Examples")}
  git-tm                 ${c.dim("current directory")}
  git-tm ../other-repo   ${c.dim("another repository")}
  git-tm -p 8080 --open

${c.dim(pkg.homepage)}
`;

function fail(message) {
  console.error(`${c.red("error")} ${message}`);
  console.error(c.dim("Run git-tm --help for usage."));
  process.exit(1);
}

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p", default: "7890" },
        host: { type: "string", default: "127.0.0.1" },
        open: { type: "boolean", short: "o", default: false },
        "no-open": { type: "boolean", default: false }, // accepted for compatibility; opening is now opt-in
        "no-avatars": { type: "boolean", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    fail(err.message);
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no browser available; the URL is printed anyway */
  }
}

function tildify(p) {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

async function main() {
  const { values, positionals } = parse();
  if (values.help) return console.log(HELP);
  if (values.version) return console.log(pkg.version);
  if (positionals.length > 1) fail("Only one repository path can be given");

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${values.port}`);

  const target = path.resolve(positionals[0] ?? ".");
  let repo;
  try {
    repo = await openRepo(target);
  } catch (err) {
    fail(err.message);
  }

  const server = createServer(repo, { avatars: !values["no-avatars"], host: values.host });
  let actual;
  try {
    actual = await listen(server, port, values.host);
  } catch (err) {
    fail(`Could not start server: ${err.message}`);
  }

  const shownHost = ["127.0.0.1", "::1", "0.0.0.0", "::"].includes(values.host) ? "localhost" : values.host;
  const url = `http://${shownHost}:${actual}`;
  const info = await repo.info().catch(() => ({}));
  const where = info.branch ?? (info.head ? info.head.slice(0, 7) : "no commits yet");

  console.log();
  console.log(`  ${c.accent(c.bold("git-tm"))} ${c.dim(`v${pkg.version}`)}`);
  console.log();
  console.log(`  ${c.dim("repo")}  ${tildify(repo.root)} ${c.dim(`(${where})`)}`);
  console.log(`  ${c.dim("url ")}  ${c.cyan(url)}`);
  if (actual !== port && port !== 0) console.log(`  ${c.dim(`port ${port} was busy, using ${actual}`)}`);
  console.log();
  console.log(c.dim("  Press Ctrl+C to stop"));
  console.log();

  if (values.open) openBrowser(url);

  // Keep serving if something unexpected goes wrong; say what happened instead of dying silently.
  const report = (err) => console.error(`${c.red("error")} ${err?.stack || err}`);
  process.on("uncaughtException", report);
  process.on("unhandledRejection", report);

  const stop = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
