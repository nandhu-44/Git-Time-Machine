<div align="center">
  <img src="src/public/logo.svg" width="96" height="96" alt="Git Time Machine logo">

  <h1>Git Time Machine</h1>

  <p>Explore any Git repository's history in your browser.<br>
  Commit graph, diffs, blame, compare and insights. One command, zero dependencies.</p>

  <a href="https://www.npmjs.com/package/git-tm"><img src="https://img.shields.io/npm/v/git-tm?color=f05133" alt="npm version"></a>
  <img src="https://img.shields.io/badge/dependencies-0-2ea44f" alt="zero dependencies">
  <img src="https://img.shields.io/npm/l/git-tm" alt="license">
</div>

<br>

![Git Time Machine showing a commit graph and a merge commit's changes](docs/screenshot.png)

## Install

```bash
npm install -g git-tm
```

Or run it once without installing:

```bash
npx git-tm
```

Requires Node.js 18.3 or newer and `git` on your `PATH`.

## Usage

Run it inside any repository (or any folder within one):

```bash
git-tm
```

Your browser opens at `http://localhost:7890`. Point it at another repository with `git-tm ../other-repo`.

| Option | Description |
| --- | --- |
| `-p, --port <number>` | Port to listen on (default `7890`; the next free port is used if it is busy) |
| `--host <address>` | Interface to bind (default `127.0.0.1`) |
| `--no-open` | Do not open the browser |
| `--no-avatars` | Do not load author avatars from GitHub or Gravatar |
| `-v, --version` | Print the version |
| `-h, --help` | Print help |

## Features

**History**
- Commit graph with branch lanes, merges, and badges for the current branch, local and remote branches and tags
- Smooth on large repositories: the list is virtualised and history loads page by page as you scroll
- Show all branches or a single branch, tag or remote
- Uncommitted changes appear on top of `HEAD`

**Commits**
- Full message, author and committer, parents, and every branch and tag that contains the commit
- Unified or split diffs with word-level highlights, a hide-whitespace toggle and full-file context
- Merge commits can be diffed against any parent
- Open the commit on GitHub, GitLab or Bitbucket when the repository has a remote

**Browse and blame**
- Walk the file tree as it was at any commit
- View a file at any point in time, with `git blame` alongside
- File history that follows renames

**Compare**
- Any two branches, tags or commits, or a commit against your working tree
- *Direct* (`a..b`) or *since branch point* (`a...b`, like a pull request)
- Ahead/behind counts, merge base, the commits in between and every changed file
- Shift-click two commits in the history to compare them

**Search**

| Query | Finds |
| --- | --- |
| `fix login` | Commit messages |
| `author:ada` | Commits by an author (name or email) |
| `path:src/app.js` | Commits that touched a path, following renames |
| `code:parseConfig` | Commits that added or removed a string (`git log -S`) |
| `a1b2c3d` | Jumps straight to a commit |

**Insights**
- Activity heatmap for the past year, weekly rhythm by day and hour, and top contributors

**Everything else**
- Light and dark themes (follows your system by default)
- Notices when the repository changes on disk and offers to refresh
- Fetch all remotes with one click
- Keyboard shortcuts: `j`/`k` to move, `Enter` to open, `/` to search, `Esc` to close, `g h`/`g c`/`g i` to switch views, `?` for help
- Works on phones and tablets

## Privacy and safety

- Everything runs locally. The server binds to `127.0.0.1` and rejects requests for other host names, so other websites cannot read your repository.
- Read-only. Git Time Machine never checks out, commits or rewrites anything. The only command that touches the network is **Fetch**, and only when you press it.
- Author avatars are loaded from GitHub (for `users.noreply.github.com` addresses) or Gravatar. Use `--no-avatars` to keep everything offline; initials are shown instead.

## How it works

`git-tm` starts a small HTTP server built on Node's standard library. It asks `git` for machine-readable output (for example `git log --format=...`, `git diff --raw -z`, `git blame --porcelain`), so it works with every Git feature your installed `git` supports: worktrees, submodules, SHA-256 repositories, `.mailmap` and more. The interface is plain HTML, CSS and JavaScript modules, with no framework and no build step.

```
src/
  cli.js           command-line entry point
  server.js        HTTP server and JSON API
  git.js           git commands and output parsing
  public/          the web interface
    js/graph.js    commit graph layout
    js/diff.js     diff rendering
test/              node:test suites
```

## Development

```bash
git clone https://github.com/nandhu-44/Git-Time-Machine.git
cd Git-Time-Machine
node src/cli.js .
```

```bash
npm test
```

## Background

Git Time Machine started at [FOSS Hack 2025](https://fossunited.org/fosshack/2025). Version 1 is a complete rewrite focused on speed, a clean interface and deeper Git features.

## License

[MIT](LICENSE)
