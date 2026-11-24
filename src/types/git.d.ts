/** Stands for the working tree (uncommitted changes) wherever a revision is accepted as a target. */
export const WORKTREE: "WORKTREE";

/** Error thrown for git failures and invalid input. `status` is an HTTP-style code (400, 404, 500, 504). */
export class GitError extends Error {
  constructor(message: string, status?: number);
  status: number;
}

export interface GitOptions {
  /** Resolve with a Buffer instead of a string. */
  raw?: boolean;
  /** Written to git's stdin. */
  input?: string | Buffer;
  /** Stop reading after this many bytes of output; the result gets `truncated: true`. Default 64 MB. */
  maxBytes?: number;
  /** Kill git after this many milliseconds. Default 60 000. */
  timeout?: number;
}

/** Run git in `cwd` with a clean, non-interactive environment and resolve with its stdout. */
export function git(cwd: string, args: string[], options: GitOptions & { raw: true }): Promise<Buffer & { truncated: boolean }>;
export function git(cwd: string, args: string[], options?: GitOptions): Promise<string>;

/** Open the repository containing `dir` (any folder inside it works). Throws GitError if there is none. */
export function openRepo(dir: string): Promise<Repo>;

/** Turn a remote URL (https or ssh) into a browsable https URL, or null. */
export function webUrl(url: string | null | undefined): string | null;

/** A branch, tag or HEAD decoration on a commit. */
export interface Ref {
  type: "head" | "branch" | "remote" | "tag" | "detached";
  name: string;
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Author date, Unix seconds. */
  date: number;
  committer: string;
  committerEmail: string;
  /** Commit date, Unix seconds. */
  commitDate: number;
  refs: Ref[];
  subject: string;
}

export interface Commit extends CommitSummary {
  body: string;
}

export interface RepoInfo {
  name: string;
  root: string;
  bare: boolean;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  branches: { name: string; target: string; upstream: string | null; ahead: number; behind: number; gone: boolean; date: number }[];
  remotes: { name: string; remote: string; short: string; target: string; date: number }[];
  tags: { name: string; target: string; annotated: boolean; message: string; date: number }[];
  /** Number of changed or untracked paths in the working tree. */
  changes: number;
  emptyTree: string;
  remoteUrl: string | null;
  gitVersion: string | null;
}

export interface LogOptions {
  /** Revision to start from. Default: HEAD plus every branch, remote and tag. */
  ref?: string;
  skip?: number;
  /** Page size, 1 to 2000. Default 300. */
  limit?: number;
  /** Commit message contains this text (case-insensitive). */
  message?: string;
  /** Author name or email contains this text. */
  author?: string;
  /** Commits that add or remove this string (`git log -S`). */
  code?: string;
  /** Only commits touching this path. */
  path?: string;
  /** Follow renames of `path`. */
  follow?: boolean;
}

export interface LogPage {
  commits: CommitSummary[];
  /** False when a filter makes the graph meaningless. */
  graph: boolean;
  /** True when there are no more pages. */
  done: boolean;
}

export interface FileChange {
  /** A, M, D, R (renamed), C (copied), T (type change) or ? (untracked). */
  status: string;
  path: string;
  oldPath?: string;
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface FileList {
  from: string;
  to: string;
  files: FileChange[];
  additions: number;
  deletions: number;
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
}

export interface Patch {
  /** Unified diff text. */
  patch: string;
  truncated: boolean;
}

export interface Range {
  /** Commits only in `to`: applied by the move, newest first. */
  added: CommitSummary[];
  /** Commits only in `from`: undone by the move, newest first. */
  removed: CommitSummary[];
  /** Snapshots to step through, in order. The last entry is `to`. */
  path: CommitSummary[];
  addedCount: number;
  removedCount: number;
  mergeBase: string | null;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  mode: string;
  oid: string;
  size: number | null;
}

export interface Blob {
  path: string;
  size: number;
  binary: boolean;
  truncated?: boolean;
  content: string;
}

export interface Blame {
  rev: string;
  path: string;
  /** Commit id for each line of the file. */
  lines: string[];
  commits: Record<string, { author?: string; email?: string; date?: number; subject?: string }>;
}

export interface Insights {
  total: number;
  first: number | null;
  last: number | null;
  /** Commits per day, keyed YYYY-MM-DD (local time). */
  days: Record<string, number>;
  /** punch[day 0-6, Sunday first][hour 0-23] = commits. */
  punch: number[][];
  contributorCount: number;
  /** Top 100 by commit count. */
  contributors: { name: string; email: string; commits: number; first: number; last: number }[];
}

/**
 * A repository opened with openRepo(). Methods accept any revision git understands
 * (branch, tag, commit id, HEAD~3, ...); results for immutable objects are cached.
 */
export interface Repo {
  readonly root: string;
  readonly gitDir: string;
  readonly bare: boolean;
  readonly name: string;
  readonly emptyTree: string;

  /** Run git in this repository. */
  run(args: string[], options?: GitOptions): Promise<string>;
  /** Full commit id for a revision, or WORKTREE. */
  resolve(rev: string): Promise<string>;
  info(): Promise<RepoInfo>;
  /** Changes whenever refs, HEAD or the index change. */
  fingerprint(): Promise<string>;
  log(options?: LogOptions): Promise<LogPage>;
  commit(rev: string): Promise<Commit>;
  /** Branches, remote branches and tags whose history contains `rev`. */
  containedIn(rev: string): Promise<{ branches: string[]; remotes: string[]; tags: string[] }>;
  /** Changed files from `from` to `to`. `from` may be "" (empty tree); `to` may be WORKTREE. */
  files(from: string, to: string, options?: DiffOptions): Promise<FileList>;
  patch(from: string, to: string, file: string, oldFile?: string, options?: DiffOptions & { context?: number }): Promise<Patch>;
  /** What moving from `from` to `to` applies and undoes, and the snapshots on the way. */
  range(from: string, to: string): Promise<Range>;
  tree(rev: string, dir?: string): Promise<{ rev: string; path: string; entries: TreeEntry[] }>;
  blob(rev: string, file: string): Promise<Blob>;
  blame(rev: string, file: string): Promise<Blame>;
  /** Activity for one revision, or for all branches when omitted. */
  insights(ref?: string): Promise<Insights>;
  /** `git fetch --all --prune`. */
  fetch(): Promise<string>;
}
