// Commit graph layout. Pure functions, no DOM: also used by the tests.
//
// Commits arrive newest first (children before parents). Each "lane" is a
// column waiting for a specific commit id. Lanes keep their column for as long
// as they live, which keeps lines straight; freed columns are reused.

export function createLayout() {
  return { lanes: [], seen: new Set() };
}

function freeSlot(lanes, avoid = -1) {
  for (let i = 0; i < lanes.length; i++) if (lanes[i] == null && i !== avoid) return i;
  return Math.max(lanes.length, avoid + 1);
}

function trim(lanes) {
  while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
}

/**
 * Lay out a page of commits, continuing from `state` (so pages can be
 * appended). Sets `commit.g = { col, up, down, pass, width }`:
 *   up   - columns whose line comes from the row above into this node
 *   down - columns this node's line continues into (one per parent)
 *   pass - columns that run straight through this row
 *   shift - [from, to] lanes that move into another column within this row
 */
export function layout(state, commits) {
  const L = state.lanes;
  for (const c of commits) {
    let col = L.indexOf(c.hash);
    const up = [];
    for (let i = 0; i < L.length; i++) if (L[i] === c.hash) up.push(i);
    if (col === -1) col = freeSlot(L);

    const before = L.slice();
    for (const i of up) L[i] = null;

    const down = [];
    const shift = [];
    const parents = c.parents.filter((p) => !state.seen.has(p));
    parents.forEach((p, k) => {
      let j = L.indexOf(p);
      if (k === 0 && j > col && L[col] == null) {
        // The parent already has a lane further right: fold that lane back
        // into this column so the first-parent line stays straight.
        L[j] = null;
        L[col] = p;
        shift.push([j, col]);
        j = col;
      } else if (j === -1) {
        j = k === 0 && L[col] == null ? col : freeSlot(L, col);
        L[j] = p;
      }
      if (!down.includes(j)) down.push(j);
    });

    const pass = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] != null && before[i] !== c.hash && L[i] === before[i]) pass.push(i);
    }

    trim(L);
    let width = Math.max(col + 1, L.length);
    for (const i of up) width = Math.max(width, i + 1);
    for (const i of pass) width = Math.max(width, i + 1);
    for (const [i] of shift) width = Math.max(width, i + 1);
    c.g = { col, up, down, pass, shift, width };
    state.seen.add(c.hash);
  }
  return state;
}

export const LANE_W = 14;

/** SVG markup for one row of the graph. */
export function rowSvg(g, { height, maxLanes, merge = false, head = false }) {
  const w = Math.min(g.width, maxLanes) * LANE_W + 6;
  const mid = height / 2;
  const x = (i) => i * LANE_W + LANE_W / 2 + 3;
  const color = (i) => `var(--lane-${i % 8})`;
  let s = "";
  for (const i of g.pass) {
    if (i < maxLanes) s += `<path d="M${x(i)} 0V${height}" stroke="${color(i)}"/>`;
  }
  const xc = x(Math.min(g.col, maxLanes - 1));
  for (const [from, to] of g.shift || []) {
    const xf = x(Math.min(from, maxLanes - 1));
    const xt = x(Math.min(to, maxLanes - 1));
    s += `<path d="M${xf} 0V${mid * 0.6}C${xf} ${height} ${xt} ${mid} ${xt} ${height}" stroke="${color(from)}"/>`;
  }
  for (const i of g.up) {
    const xi = x(Math.min(i, maxLanes - 1));
    s += i === g.col
      ? `<path d="M${xi} 0V${mid}" stroke="${color(i)}"/>`
      : `<path d="M${xi} 0C${xi} ${mid} ${xc} ${mid * 0.4} ${xc} ${mid}" stroke="${color(i)}"/>`;
  }
  for (const j of g.down) {
    const xj = x(Math.min(j, maxLanes - 1));
    s += j === g.col
      ? `<path d="M${xc} ${mid}V${height}" stroke="${color(j)}"/>`
      : `<path d="M${xc} ${mid}C${xc} ${height - mid * 0.4} ${xj} ${mid} ${xj} ${height}" stroke="${color(j)}"/>`;
  }
  const c = color(g.col);
  s += merge
    ? `<circle cx="${xc}" cy="${mid}" r="3.5" fill="var(--bg-panel)" stroke="${c}" stroke-width="2"/>`
    : `<circle cx="${xc}" cy="${mid}" r="${head ? 5 : 4}" fill="${c}"${head ? ` stroke="var(--bg-panel)" stroke-width="2"` : ""}/>`;
  if (head) s += `<circle cx="${xc}" cy="${mid}" r="7.5" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  return `<svg class="graph" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" fill="none" stroke-width="2" aria-hidden="true">${s}</svg>`;
}
