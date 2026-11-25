# Changelog

All notable changes to git-tm. Each version is on [npm](https://www.npmjs.com/package/git-tm) and has a [GitHub release](https://github.com/nandhu-44/Git-Time-Machine/releases).

## v1.1.1

_Released 2026-11-25_

#### Fixes
- Untracked symlinks now show their target, like git, instead of the file they point to; paths that lead outside the repository through a symlinked folder are refused.
- The startup error message is escaped.
- The Host header check ignores letter case, and malformed URLs get a 400 instead of a server error.
- Long branch names in badges end with an ellipsis.
- The last month and hour labels in Insights are no longer cut off.
- Time travel tells you when a very long trip skips part of the middle on the slider.
- `git()` in the JavaScript API always resolves with a plain string.

#### Project
- A demo GIF in the README, a demo video and fresh screenshots on the website.
- A contributing guide, issue forms and a pull request template.

## v1.1.0: JavaScript API

_Released 2026-11-24_

git-tm is now a library as well as a command, with TypeScript types included and still no dependencies.

```js
import { openRepo } from "git-tm";

const repo = await openRepo(".");
const trip = await repo.range("v1.0.0", "main");
console.log(`${trip.addedCount} commits applied, ${trip.removedCount} undone`);
```

- Entry points: `git-tm`, `git-tm/git`, `git-tm/server` and `git-tm/graph`.
- Read history, commits, diffs, trees, blame and insights, embed the web interface with `createServer`, or reuse the commit graph layout.
- See the [API documentation](https://git-time-machine.js.org/guide.html#api).

## v1.0.2: documentation website

_Released 2026-11-17_

- New documentation website at **[git-time-machine.js.org](https://git-time-machine.js.org)**, covering every feature, time travel, keyboard shortcuts and troubleshooting.
- The npm package now links to the website, with a refreshed description and keywords.

## v1.0.1

_Released 2026-11-07_

- Documents running git-tm as the Git subcommand `git tm`, in `--help` and the README.

## v1.0.0: a complete rewrite

_Released 2026-11-06_

Version 1 rebuilds Git Time Machine from scratch: no runtime dependencies, a new interface and much deeper Git features.

#### Highlights
- **Time travel** between any two commits, branches or tags, or your working tree: forward, back in time, or across branches. Step through every snapshot on the way with a slider or the arrow keys, and pick commits straight from History (press `t`).
- **Commit graph** with branch lanes, merges and badges for branches, remote branches and tags. The list is virtualised and loads page by page, so large repositories stay smooth.
- **Diffs** in unified or split view, with word-level highlights, a hide-whitespace toggle, full-file context and diffs against any parent of a merge.
- **Browse and blame**: the file tree at any commit, any file at any point in time with `git blame`, and file history that follows renames.
- **Search** by message, `author:`, `path:` or `code:` (like `git log -S`), or paste a commit id to jump to it.
- **Insights**: an activity heatmap, weekly rhythm and top contributors.
- Keyboard shortcuts for everything (`?` lists them), light and dark themes, and layouts for phones and tablets.

#### Command line
- Works as `git-tm` and as the Git subcommand `git tm`.
- `--open` opens the browser (opening is now opt-in), plus `-p/--port`, `--host` and `--no-avatars`.

#### Safety
- Read-only: it never checks out, commits or rewrites anything.
- Binds to `127.0.0.1`, rejects other host names (DNS rebinding), uses a strict content security policy and never lets input reach git as an option.
- Notices when the repository changes on disk, and shows a banner and reconnects if the git-tm process stops.
- Branch history is no longer blocked by ad blockers.

## Before v1.0.0

Versions 0.1.0 to 0.4.1 were the original FOSS Hack 2025 project, before the rewrite.
