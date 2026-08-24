// ---------------------------------------------------------------------------
// Terrain types + procedural world generation
// ---------------------------------------------------------------------------

export const T = {
  VOID:   0,
  GROUND: 1,
  ROCK:   2,
  CRATER: 3,
  LIQUID: 4,
  LAVA:   5,
  FLORA:  6,
} as const;

export type TerrainId = typeof T[keyof typeof T];

export const TERRAIN_COLORS: Record<TerrainId, string> = {
  [T.VOID]:   '#050508',
  [T.GROUND]: '#7a5c3e',
  [T.ROCK]:   '#3d3d4d',
  [T.CRATER]: '#2e1a10',
  [T.LIQUID]: '#0d3d5c',
  [T.LAVA]:   '#fca311',
  [T.FLORA]:  '#1a6b45',
};

// Rendered in this order so blobs layer predictably (later ids paint on top)
export const TERRAIN_DRAW_ORDER: TerrainId[] = [
  T.VOID, T.GROUND, T.CRATER, T.FLORA, T.LIQUID, T.LAVA, T.ROCK,
];

// Anything an entity can stand on — reserved for spawning + future pathfinding
export const WALKABLE: Record<TerrainId, boolean> = {
  [T.VOID]:   false,
  [T.GROUND]: true,
  [T.ROCK]:   false,
  [T.CRATER]: true,
  [T.LIQUID]: false,
  [T.LAVA]:   false,
  [T.FLORA]:  true,
};

// World is fixed-size in tiles; tiles are fixed-size in px so the camera can
// scroll a world much larger than the viewport.
export const TILE       = 56;
export const WORLD_COLS = 72;
export const WORLD_ROWS = 72;
export const WORLD_W    = WORLD_COLS * TILE;
export const WORLD_H    = WORLD_ROWS * TILE;

const BORDER = 2; // rock ring thickness, keeps the player inside the playfield

// ---------------------------------------------------------------------------
// PRNG — mulberry32, so a seed reproduces a world exactly
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

/**
 * Smooth value noise: a coarse random lattice, smoothstep-interpolated. The
 * lattice spacing sets the patch size — that's what gives broad regions of one
 * biome instead of the per-tile speckle a plain rand() produces.
 */
function makeNoise(rand: Rand, spacing: number) {
  const cols = Math.ceil(WORLD_COLS / spacing) + 2;
  const rows = Math.ceil(WORLD_ROWS / spacing) + 2;

  const lattice: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: number[] = [];
    for (let c = 0; c < cols; c++) line.push(rand());
    lattice.push(line);
  }

  return (x: number, y: number): number => {
    const gx = x / spacing;
    const gy = y / spacing;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    // smoothstep, so patch borders curve instead of forming straight creases
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    const a = lattice[y0][x0];
    const b = lattice[y0][x0 + 1];
    const c = lattice[y0 + 1][x0];
    const d = lattice[y0 + 1][x0 + 1];

    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

/** Fill every tile within `radius` of (cx, cy). */
function stampDisc(
  grid: TerrainId[][],
  terrain: TerrainId,
  cx: number,
  cy: number,
  radius: number
) {
  const r2 = radius * radius;
  const from = Math.floor(-radius) - 1;
  const to = Math.ceil(radius) + 1;

  for (let dr = from; dr <= to; dr++) {
    const row = cy + dr;
    if (row < 0 || row >= WORLD_ROWS) continue;
    for (let dc = from; dc <= to; dc++) {
      const col = cx + dc;
      if (col < 0 || col >= WORLD_COLS) continue;
      if (dc * dc + dr * dr > r2) continue;
      grid[row][col] = terrain;
    }
  }
}

type Point = { col: number; row: number };

/**
 * Trace a watercourse from `start` toward `end`.
 *
 * The heading turns gradually and is only weakly steered toward the mouth, so
 * the channel wanders into real meanders and oxbows instead of tracing a tidy
 * sine wave. Returns the centreline so tributaries can join it.
 */
function traceCourse(rand: Rand, start: Point, end: Point): Point[] {
  const path: Point[] = [];
  let col = start.col;
  let row = start.row;
  let heading = Math.atan2(end.row - row, end.col - col);

  // Low pull = lazy, wandering river. High wander = tighter meanders.
  const pull = 0.05 + rand() * 0.05;
  const wander = 0.4 + rand() * 0.35;
  const limit = (WORLD_COLS + WORLD_ROWS) * 3;

  for (let i = 0; i < limit; i++) {
    path.push({ col, row });

    const toMouth = Math.atan2(end.row - row, end.col - col);
    let turn = toMouth - heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;

    heading += turn * pull + (rand() - 0.5) * wander;
    col += Math.cos(heading);
    row += Math.sin(heading);

    const dc = end.col - col;
    const dr = end.row - row;
    if (dc * dc + dr * dr < 4) break;
    // Ran off the map — that's a mouth too
    if (col < -2 || col > WORLD_COLS + 2 || row < -2 || row > WORLD_ROWS + 2) {
      break;
    }
  }

  return path;
}

/**
 * Paint a traced course as water, widening from source to mouth the way a real
 * river gathers volume downstream.
 *
 * Rivers are solid, so each gets a couple of fords — dry gaps wide enough to
 * walk through. A ford has to out-span the channel's own radius, or the discs
 * on either side simply fill it back in.
 */
function paintCourse(
  grid: TerrainId[][],
  rand: Rand,
  path: Point[],
  sourceRadius: number,
  mouthRadius: number
) {
  const fordCount = 1 + Math.floor(rand() * 2);
  const fords: number[] = [];
  for (let i = 0; i < fordCount; i++) {
    fords.push(0.15 + rand() * 0.7); // as a fraction along the course
  }

  for (let i = 0; i < path.length; i++) {
    const along = i / Math.max(1, path.length - 1);
    const radius = sourceRadius + (mouthRadius - sourceRadius) * along;

    let dry = false;
    for (let f = 0; f < fords.length; f++) {
      const halfSpan = (radius + 2.4) / path.length;
      if (Math.abs(along - fords[f]) < halfSpan) {
        dry = true;
        break;
      }
    }
    if (dry) continue;

    stampDisc(grid, T.LIQUID, Math.round(path[i].col), Math.round(path[i].row), radius);
  }
}

/** A point just off one edge, so the river visibly flows in from off-map. */
function edgePoint(rand: Rand, side: number): Point {
  const inset = BORDER + 3;
  const spanC = WORLD_COLS - inset * 2;
  const spanR = WORLD_ROWS - inset * 2;

  if (side === 0) return { col: inset + rand() * spanC, row: -1 };
  if (side === 1) return { col: WORLD_COLS, row: inset + rand() * spanR };
  if (side === 2) return { col: inset + rand() * spanC, row: WORLD_ROWS };
  return { col: -1, row: inset + rand() * spanR };
}

/** One trunk river across the map, plus tributaries feeding into it. */
function carveRiverSystem(grid: TerrainId[][], rand: Rand) {
  const side = Math.floor(rand() * 4);
  const source = edgePoint(rand, side);
  const mouth = edgePoint(rand, (side + 2) % 4); // opposite edge

  const trunk = traceCourse(rand, source, mouth);
  paintCourse(grid, rand, trunk, 1.3 + rand() * 0.4, 2.1 + rand() * 0.9);

  // Tributaries join partway down the trunk, narrower than what they feed.
  // Kept at 1.2+ so even a headwater reads as a channel rather than speckle —
  // and so nothing solid is ever a lone tile.
  const branches = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < branches; i++) {
    const joinAt = Math.floor((0.35 + rand() * 0.55) * (trunk.length - 1));
    const join = trunk[joinAt];
    const from = edgePoint(rand, Math.floor(rand() * 4));
    const branch = traceCourse(rand, from, join);
    paintCourse(grid, rand, branch, 1.2, 1.5 + rand() * 0.5);
  }
}

export function generateGrid(seed: number): TerrainId[][] {
  const rand = mulberry32(seed);

  // Two octaves: the coarse one sets the biome regions, the finer one breaks
  // up their borders so patches don't read as smooth ovals.
  const coarse = makeNoise(rand, 15);
  const fine = makeNoise(rand, 6);

  const grid: TerrainId[][] = [];
  for (let row = 0; row < WORLD_ROWS; row++) {
    const line: TerrainId[] = [];
    for (let col = 0; col < WORLD_COLS; col++) {
      const n = coarse(col, row) * 0.75 + fine(col, row) * 0.25;
      if (n > 0.6) line.push(T.FLORA); // green
      else if (n < 0.4) line.push(T.CRATER); // dark earth
      else line.push(T.GROUND); // brown
    }
    grid.push(line);
  }

  // Border before the water, so a river can cut through the rim and read as
  // flowing off the map rather than being dammed at the edge.
  for (let row = 0; row < WORLD_ROWS; row++) {
    for (let col = 0; col < WORLD_COLS; col++) {
      const edge = Math.min(row, col, WORLD_ROWS - 1 - row, WORLD_COLS - 1 - col);
      if (edge < BORDER) grid[row][col] = T.ROCK;
    }
  }

  const systems = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < systems; i++) carveRiverSystem(grid, rand);

  return grid;
}

/**
 * Dry out a crossing so `to` is walkable from `from`.
 *
 * Rivers are solid, so a channel can otherwise seal the house off completely.
 * This walks a cost-weighted search — land is cheap, water expensive — and
 * turns whatever water the cheapest route crosses into a ford. Land-only
 * routes cost nothing to keep, so when the map is already connected this
 * changes nothing.
 */
export function ensureLandRoute(
  grid: TerrainId[][],
  from: { col: number; row: number },
  to: { col: number; row: number }
) {
  const rows = grid.length;
  const cols = grid[0].length;
  const WATER_COST = 60;

  const cost = new Array<number>(rows * cols).fill(Infinity);
  const prev = new Array<number>(rows * cols).fill(-1);
  const startIdx = from.row * cols + from.col;
  const goalIdx = to.row * cols + to.col;
  cost[startIdx] = 0;

  // Small maps and a coarse cost scale, so a simple repeated-scan search is
  // plenty — no need for a real priority queue.
  const queue: number[] = [startIdx];
  while (queue.length > 0) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (cost[queue[i]] < cost[queue[best]]) best = i;
    }
    const idx = queue.splice(best, 1)[0];
    if (idx === goalIdx) break;

    const row = Math.floor(idx / cols);
    const col = idx % cols;

    for (let d = 0; d < 4; d++) {
      const nRow = row + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const nCol = col + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nRow < 0 || nCol < 0 || nRow >= rows || nCol >= cols) continue;

      const terrain = grid[nRow][nCol];
      if (terrain === T.ROCK) continue; // the rim stays sealed
      const step = terrain === T.LIQUID ? WATER_COST : 1;

      const nIdx = nRow * cols + nCol;
      const next = cost[idx] + step;
      if (next >= cost[nIdx]) continue;
      cost[nIdx] = next;
      prev[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (cost[goalIdx] === Infinity) return; // walled in by rock; nothing to do

  // Widen the crossing slightly so the player's radius actually fits
  for (let idx = goalIdx; idx !== -1; idx = prev[idx]) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    if (grid[row][col] !== T.LIQUID) continue;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < BORDER || c < BORDER) continue;
        if (r >= rows - BORDER || c >= cols - BORDER) continue;
        if (grid[r][c] === T.LIQUID) grid[r][c] = T.GROUND;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/** Terrain the player cannot walk onto. */
export const SOLID_TERRAIN: TerrainId[] = [T.LIQUID];

/**
 * Flattened solidity mask. A river is hundreds of tiles, so passing it to the
 * movement worklet as a rect list would mean hundreds of tests per frame; a
 * grid lookup only touches the handful of tiles the player overlaps.
 */
export interface SolidGrid {
  /** Row-major, 1 = solid. */
  cells: number[];
  cols: number;
  rows: number;
  tile: number;
}

/**
 * Circle vs solid tiles. Only the tiles under the bounding box are examined, so
 * cost doesn't scale with map size.
 *
 * Marked as a worklet because the movement loop calls it on the UI thread, but
 * it's a plain function too — JS callers use it to ask "is this spot standable"
 * before letting the player out of a boat.
 */
export function isSolidAt(
  g: SolidGrid,
  px: number,
  py: number,
  radius: number
): boolean {
  "worklet";
  const minCol = Math.max(0, Math.floor((px - radius) / g.tile));
  const maxCol = Math.min(g.cols - 1, Math.floor((px + radius) / g.tile));
  const minRow = Math.max(0, Math.floor((py - radius) / g.tile));
  const maxRow = Math.min(g.rows - 1, Math.floor((py + radius) / g.tile));

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (g.cells[row * g.cols + col] === 0) continue;

      const tileX = col * g.tile;
      const tileY = row * g.tile;
      const nearestX = Math.max(tileX, Math.min(px, tileX + g.tile));
      const nearestY = Math.max(tileY, Math.min(py, tileY + g.tile));
      const dx = px - nearestX;
      const dy = py - nearestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }

  return false;
}

export function buildSolidGrid(
  grid: TerrainId[][],
  solid: TerrainId[] = SOLID_TERRAIN
): SolidGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const cells = new Array<number>(rows * cols).fill(0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (solid.includes(grid[row][col])) cells[row * cols + col] = 1;
    }
  }

  return { cells, cols, rows, tile: TILE };
}

/** The inverse: a boat is confined to water, so all dry land blocks it. */
export function buildBoatSolidGrid(grid: TerrainId[][]): SolidGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const cells = new Array<number>(rows * cols).fill(0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] !== T.LIQUID) cells[row * cols + col] = 1;
    }
  }

  return { cells, cols, rows, tile: TILE };
}

/**
 * Water tiles that touch walkable land — the only places a boat can be left.
 * Precomputed as a mask so the check is a single lookup on the UI thread.
 */
export function buildShoreMask(grid: TerrainId[][]): SolidGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const cells = new Array<number>(rows * cols).fill(0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] !== T.LIQUID) continue;

      for (let d = 0; d < 4; d++) {
        const r = row + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const c = col + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        if (WALKABLE[grid[r][c]]) {
          cells[row * cols + col] = 1;
          break;
        }
      }
    }
  }

  return { cells, cols, rows, tile: TILE };
}

/**
 * Tiles within arm's reach of water — the water itself, or anything touching
 * it. Covers both standing on the bank and sitting in a boat.
 */
export function buildWaterAccessMask(grid: TerrainId[][]): SolidGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const cells = new Array<number>(rows * cols).fill(0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] === T.LIQUID) {
        cells[row * cols + col] = 1;
        continue;
      }

      for (let d = 0; d < 4; d++) {
        const r = row + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const c = col + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        if (grid[r][c] === T.LIQUID) {
          cells[row * cols + col] = 1;
          break;
        }
      }
    }
  }

  return { cells, cols, rows, tile: TILE };
}

/**
 * Closest tile of a given kind, searched outward in rings.
 *
 * Boarding and disembarking both snap the player to a tile centre. A tile is
 * 56px and the player only 18px in radius, so a centred player never overlaps
 * a neighbouring tile — which is what makes the snap always land somewhere
 * legal for the mask that's about to take effect.
 */
function nearestTileWhere(
  grid: TerrainId[][],
  col: number,
  row: number,
  wanted: (t: TerrainId) => boolean,
  maxTiles: number
): { col: number; row: number } | null {
  const rows = grid.length;
  const cols = grid[0].length;

  for (let ring = 0; ring <= maxTiles; ring++) {
    for (let dRow = -ring; dRow <= ring; dRow++) {
      for (let dCol = -ring; dCol <= ring; dCol++) {
        if (Math.max(Math.abs(dRow), Math.abs(dCol)) !== ring) continue;
        const r = row + dRow;
        const c = col + dCol;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        if (wanted(grid[r][c])) return { col: c, row: r };
      }
    }
  }

  return null;
}

export function nearestWaterTile(
  grid: TerrainId[][],
  col: number,
  row: number,
  maxTiles = 4
) {
  return nearestTileWhere(grid, col, row, (t) => t === T.LIQUID, maxTiles);
}

export function nearestWalkableTile(
  grid: TerrainId[][],
  col: number,
  row: number,
  maxTiles = 4
) {
  return nearestTileWhere(grid, col, row, (t) => WALKABLE[t], maxTiles);
}

/** Nearest walkable cell to the world centre, cleared of hazards. */
export function findSpawn(grid: TerrainId[][]): { col: number; row: number } {
  const midCol = Math.floor(WORLD_COLS / 2);
  const midRow = Math.floor(WORLD_ROWS / 2);

  for (let ring = 0; ring < Math.max(WORLD_COLS, WORLD_ROWS); ring++) {
    for (let dRow = -ring; dRow <= ring; dRow++) {
      for (let dCol = -ring; dCol <= ring; dCol++) {
        if (Math.max(Math.abs(dRow), Math.abs(dCol)) !== ring) continue;
        const row = midRow + dRow;
        const col = midCol + dCol;
        if (row < BORDER || col < BORDER) continue;
        if (row >= WORLD_ROWS - BORDER || col >= WORLD_COLS - BORDER) continue;
        if (!WALKABLE[grid[row][col]]) continue;
        // Clear a small pad so the player never starts wedged against rock
        stampBlobClear(grid, col, row);
        return { col, row };
      }
    }
  }

  return { col: midCol, row: midRow };
}

function stampBlobClear(grid: TerrainId[][], col: number, row: number) {
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (r < BORDER || c < BORDER) continue;
      if (r >= WORLD_ROWS - BORDER || c >= WORLD_COLS - BORDER) continue;
      if (!WALKABLE[grid[r][c]]) grid[r][c] = T.GROUND;
    }
  }
}

// ---------------------------------------------------------------------------
// House
// ---------------------------------------------------------------------------

export const HOUSE_COLS = 5;
export const HOUSE_ROWS = 3;

export interface HousePlacement {
  /** Top-left corner of the footprint, in tiles. */
  col: number;
  row: number;
  /** Doorway tile, centred on the bottom wall. */
  doorCol: number;
  doorRow: number;
}

/**
 * Drops the house a short walk from spawn and flattens its footprint (plus the
 * tile in front of the door) to GROUND, so it never lands in rock or water.
 */
export function placeHouse(
  grid: TerrainId[][],
  spawn: { col: number; row: number }
): HousePlacement {
  const col = Math.max(
    BORDER,
    Math.min(WORLD_COLS - BORDER - HOUSE_COLS, spawn.col + 4)
  );
  const row = Math.max(
    BORDER,
    Math.min(WORLD_ROWS - BORDER - HOUSE_ROWS - 1, spawn.row - HOUSE_ROWS - 2)
  );

  for (let r = row; r < row + HOUSE_ROWS; r++) {
    for (let c = col; c < col + HOUSE_COLS; c++) {
      grid[r][c] = T.GROUND;
    }
  }

  const doorCol = col + Math.floor(HOUSE_COLS / 2);
  const doorRow = row + HOUSE_ROWS - 1;

  // Keep the approach to the door walkable
  const approach = doorRow + 1;
  if (approach < WORLD_ROWS - BORDER) {
    for (let c = doorCol - 1; c <= doorCol + 1; c++) {
      if (c < BORDER || c >= WORLD_COLS - BORDER) continue;
      grid[approach][c] = T.GROUND;
    }
  }

  return { col, row, doorCol, doorRow };
}

/**
 * The nearest spot to `from` where a boat can be beached: a walkable tile that
 * touches water. Falls back to `from` if the map somehow has no shoreline.
 */
export function placeBoat(
  grid: TerrainId[][],
  from: { col: number; row: number },
  /** Keeps the boat off the doorstep, so its tap area can't overlap the door's. */
  minTiles = 2
): { col: number; row: number } {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen = new Set<number>([from.row * cols + from.col]);
  const queue: { col: number; row: number }[] = [from];
  let fallback: { col: number; row: number } | null = null;

  const touchesWater = (col: number, row: number) => {
    for (let d = 0; d < 4; d++) {
      const r = row + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const c = col + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      if (grid[r][c] === T.LIQUID) return true;
    }
    return false;
  };

  while (queue.length > 0) {
    const cell = queue.shift()!;

    if (WALKABLE[grid[cell.row][cell.col]] && touchesWater(cell.col, cell.row)) {
      const dc = cell.col - from.col;
      const dr = cell.row - from.row;
      if (dc * dc + dr * dr >= minTiles * minTiles) return cell;
      // Usable, but too close — keep it only in case nothing better turns up
      if (fallback === null) fallback = cell;
    }

    for (let d = 0; d < 4; d++) {
      const row = cell.row + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const col = cell.col + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (row < BORDER || col < BORDER) continue;
      if (row >= rows - BORDER || col >= cols - BORDER) continue;

      const idx = row * cols + col;
      if (seen.has(idx)) continue;
      seen.add(idx);
      queue.push({ col, row });
    }
  }

  return fallback ?? from;
}

/** Walkable cells scattered across the world, kept clear of the spawn pad. */
export function pickEnemyCells(
  grid: TerrainId[][],
  seed: number,
  count: number,
  spawn: { col: number; row: number },
  minTilesFromSpawn: number,
): { col: number; row: number }[] {
  const rand  = mulberry32(seed ^ 0x9e3779b9);
  const cells: { col: number; row: number }[] = [];
  const minD2 = minTilesFromSpawn * minTilesFromSpawn;

  let attempts = 0;
  while (cells.length < count && attempts < count * 200) {
    attempts++;
    const col = BORDER + Math.floor(rand() * (WORLD_COLS - BORDER * 2));
    const row = BORDER + Math.floor(rand() * (WORLD_ROWS - BORDER * 2));
    if (!WALKABLE[grid[row][col]]) continue;

    const dCol = col - spawn.col;
    const dRow = row - spawn.row;
    if (dCol * dCol + dRow * dRow < minD2) continue;

    cells.push({ col, row });
  }

  return cells;
}

/**
 * A plain enclosed room — floor with a one-tile wall ring. Interiors are
 * hand-sized maps, so they skip the blob/ridge generation entirely.
 */
export function generateRoom(cols: number, rows: number): TerrainId[][] {
  const grid: TerrainId[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: TerrainId[] = [];
    for (let col = 0; col < cols; col++) {
      const isWall =
        row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
      line.push(isWall ? T.ROCK : T.GROUND);
    }
    grid.push(line);
  }

  return grid;
}

/**
 * Collapse the grid into horizontal runs of identical terrain — far fewer rects
 * to hand to Skia than one per tile.
 */
export interface TerrainRun {
  terrain: TerrainId;
  x:       number;
  y:       number;
  width:   number;
  height:  number;
}

export function buildTerrainRuns(grid: TerrainId[][]): TerrainRun[] {
  const runs: TerrainRun[] = [];
  // Taken from the grid itself, not the world constants — interiors use this
  // too and they're a different size.
  const rows = grid.length;
  const cols = grid[0].length;

  for (let row = 0; row < rows; row++) {
    let startCol = 0;
    for (let col = 1; col <= cols; col++) {
      const same = col < cols && grid[row][col] === grid[row][startCol];
      if (same) continue;
      runs.push({
        terrain: grid[row][startCol],
        x:       startCol * TILE,
        y:       row * TILE,
        width:   (col - startCol) * TILE,
        height:  TILE,
      });
      startCol = col;
    }
  }

  return runs;
}
