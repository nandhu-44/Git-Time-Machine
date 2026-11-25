# Security policy

## Supported versions

Security fixes go into the latest release of git-tm. Please update before reporting:

```bash
npm install -g git-tm@latest
```

| Version | Supported |
| --- | --- |
| 1.x (latest) | Yes |
| 0.x | No |

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through [GitHub's private vulnerability reporting](https://github.com/nandhu-44/Git-Time-Machine/security/advisories/new) instead.

Include what you found, how to reproduce it, and which version, operating system and browser you used. You should get a reply within a few days. Once a fix is released, the advisory is published and you are credited unless you prefer otherwise.

## What counts

git-tm runs a local web server that reads your repository. Things we especially want to hear about:

- Another website or device being able to read your repository through git-tm (for example by getting around the Host header check, the content security policy or the `x-git-tm` header on POST requests)
- Input from a URL, commit, branch name or file name that runs a command, reaches git as an option, or escapes the repository
- Anything that makes git-tm modify a repository; it is meant to be read-only

Running git-tm with `--host 0.0.0.0` intentionally exposes it to your network, so reports that depend on that setting are out of scope unless they go beyond reading the repository.
