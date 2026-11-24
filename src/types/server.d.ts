import type { Server } from "node:http";
import type { Repo } from "./git.js";

export interface ServerOptions {
  /** Load author avatars from GitHub and Gravatar. Default true. */
  avatars?: boolean;
  /** The host you will listen on. For loopback hosts, requests for other host names are rejected. Default "127.0.0.1". */
  host?: string;
}

/** An HTTP server for the git-tm web interface and its JSON API. Call listen() to start it. */
export function createServer(repo: Repo, options?: ServerOptions): Server;

/** Listen on `port`, or the next free one (up to `attempts` tries). Resolves with the port used. */
export function listen(server: Server, port: number, host: string, attempts?: number): Promise<number>;
