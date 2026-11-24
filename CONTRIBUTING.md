# Contributing to Git Time Machine

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome. This guide covers how the project is put together and what a good change looks like.

## Ways to help

- **Report a bug** with the [bug report form](https://github.com/nandhu-44/Git-Time-Machine/issues/new?template=bug_report.yml). Include your git-tm, Node.js, git and browser versions and, if you can, the repository (or a small one that shows the problem).
- **Suggest a feature** with the [feature request form](https://github.com/nandhu-44/Git-Time-Machine/issues/new?template=feature_request.yml). Describe the problem you are trying to solve, not only the solution.
- **Improve the docs.** The website is plain HTML in [`docs/`](docs); typos and unclear explanations are great first contributions.
- **Pick up an issue.** Look for the `good first issue` and `help wanted` labels. Comment on the issue before starting something large, so nobody does the same work twice.

## Getting started

You need Node.js 18.3 or newer and git. There is nothing to install or build.

```bash
git clone https://github.com/<you>/Git-Time-Machine.git
cd Git-Time-Machine
node src/cli.js .
```

Open `http://localhost:7890`. Edit files in `src/public/` and reload the page; restart the command after changing `src/*.js`.

To use your working copy as the `git-tm` and `git tm` commands everywhere (undo with `npm unlink -g git-tm`):

```bash
npm link
```

## Project layout

```
src/
  cli.js             command-line entry point (argument parsing, startup)
  index.js           public JavaScript API (re-exports)
  git.js             runs git and parses its output; the Repo class
  server.js          HTTP server, JSON API, security checks
  types/             TypeScript declarations for the public API
  public/            the web interface, served as-is
    index.html
    app.css
    js/main.js       routing, views, keyboard shortcuts
    js/history.js    virtualised commit list and time travel picking
    js/compare.js    time travel (Compare) view
    js/detail.js     commit detail pane
    js/diff.js       unified and split diff rendering
    js/graph.js      commit graph lane layout (pure functions)
    js/insights.js   heatmap, punch card, contributors
    js/ui.js         shared helpers (api(), html``, formatting, toasts)
test/                node:test suites and a fixture repository builder
docs/                the website, served by GitHub Pages
```

A request goes from the browser (`api()` in `ui.js`) to a route in `server.js`, which calls a `Repo` method in `git.js`, which runs `git` and parses its output.

## Principles

These keep git-tm small, fast and safe. Changes that break them are unlikely to be merged, so please open an issue first if you think one should change.

- **No runtime dependencies.** Use Node's standard library and the browser's built-in APIs. No frameworks, bundlers or build steps.
- **Ask git, don't reimplement it.** Use machine-readable output (`-z`, `--porcelain`, `--format` with NUL separators) so odd file names and messages parse correctly.
- **Read-only.** git-tm never checks out, commits, resets or rewrites anything. `Fetch` is the only command that touches the network.
- **Safe by default.** User input never reaches git as an option: revisions go through `checkRev`, paths through `checkPath`, and paths come after `--`. Keep the loopback-only binding, Host header check, CSP and the `x-git-tm` header on POST requests.
- **Fast on large repositories.** Page and virtualise lists, cache results for immutable objects, and avoid work that grows with the whole history on every request.
- **Works everywhere.** Linux, macOS and Windows; Node 18 to the latest; light and dark themes; phone-sized screens; keyboard only.

## Code style

- Plain ES modules, two-space indentation, double quotes, semicolons. Match the code around you.
- Prefer small, readable functions over clever ones. Comment *why*, not *what*.
- In the interface, build markup with the `html` tagged template from `ui.js`, which escapes every value. Use `raw()` only for markup you built yourself, never for text from git or the user.
- Keep the public API in `src/index.js` and `src/types/` in sync. Changing or removing anything in it can break other people's code, so open an issue first.

## Tests

```bash
npm test
```

Tests use `node:test` and build a throwaway repository with branches, merges, tags, renames and binary files (`test/fixture.js`). Add a test for every bug fix and every new `Repo` method or API route. CI runs the suite on Linux with Node.js 18, 20, 22 and 24, and on macOS and Windows with Node.js 24.

For interface changes, please check them in a browser in both themes and at phone width, and include a screenshot in your pull request.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change. Small pull requests get reviewed faster.
3. Run `npm test` and try your change with `node src/cli.js` on a real repository.
4. Update the README and `docs/` if you change behaviour, options or the API.
5. Write a clear commit message: a short summary line in the imperative ("Add file history search"), then the reason for the change if it isn't obvious.
6. Open the pull request and fill in the template.

## Working on the website

The site in `docs/` is plain HTML and CSS. Preview it with any static server:

```bash
python3 -m http.server -d docs 8000
```

## Security issues

Please don't open a public issue for a security problem. Use [GitHub's private vulnerability reporting](https://github.com/nandhu-44/Git-Time-Machine/security/advisories/new) instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
