export interface GraphRow {
  /** Column of this commit's node. */
  col: number;
  /** Columns whose line comes from the row above into the node. */
  up: number[];
  /** Columns the node's line continues into, one per parent. */
  down: number[];
  /** Columns that run straight through this row. */
  pass: number[];
  /** [from, to] lanes that move to another column in this row. */
  shift: [number, number][];
  /** Number of columns this row needs. */
  width: number;
}

export interface LayoutState {
  lanes: (string | null)[];
  seen: Set<string>;
}

/** Fresh layout state. */
export function createLayout(): LayoutState;

/**
 * Lay out commits (newest first, children before parents), continuing from `state`
 * so pages can be appended. Sets `commit.g` on each commit.
 */
export function layout<T extends { hash: string; parents: string[] }>(state: LayoutState, commits: T[]): LayoutState;

export const LANE_W: number;

/** SVG markup for one row of the graph. */
export function rowSvg(g: GraphRow, options: { height: number; maxLanes: number; merge?: boolean; head?: boolean }): string;
