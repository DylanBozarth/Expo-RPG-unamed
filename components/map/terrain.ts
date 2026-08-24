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

/** Stamp one ragged blob of `terrain` centred on (cx, cy). */
function stampBlob(
  grid: TerrainId[][],
  rand: Rand,
  terrain: TerrainId,
  cx: number,
  cy: number,
  radius: number,
) {
  const r2 = radius * radius;
  for (let row = cy - radius; row <= cy + radius; row++) {
    if (row < 0 || row >= WORLD_ROWS) continue;
    for (let col = cx - radius; col <= cx + radius; col++) {
      if (col < 0 || col >= WORLD_COLS) continue;
      const dx = col - cx;
      const dy = row - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // Fade the edge out so blobs get organic, non-circular outlines
      const edge = d2 / r2;
      if (edge > 0.45 && rand() < (edge - 0.45) * 1.6) continue;
      grid[row][col] = terrain;
    }
  }
}

function scatterBlobs(
  grid: TerrainId[][],
  rand: Rand,
  terrain: TerrainId,
  count: number,
  minRadius: number,
  maxRadius: number,
) {
  for (let i = 0; i < count; i++) {
    const cx     = Math.floor(rand() * WORLD_COLS);
    const cy     = Math.floor(rand() * WORLD_ROWS);
    const radius = minRadius + Math.floor(rand() * (maxRadius - minRadius + 1));
    stampBlob(grid, rand, terrain, cx, cy, radius);
  }
}

/** Random-walk a winding ridge of `terrain` across the map. */
function carveRidge(grid: TerrainId[][], rand: Rand, terrain: TerrainId, steps: number) {
  let col   = Math.floor(rand() * WORLD_COLS);
  let row   = Math.floor(rand() * WORLD_ROWS);
  let angle = rand() * Math.PI * 2;

  for (let i = 0; i < steps; i++) {
    angle += (rand() - 0.5) * 0.9;
    col = Math.max(0, Math.min(WORLD_COLS - 1, col + Math.round(Math.cos(angle) * 1.5)));
    row = Math.max(0, Math.min(WORLD_ROWS - 1, row + Math.round(Math.sin(angle) * 1.5)));
    stampBlob(grid, rand, terrain, col, row, 1 + Math.floor(rand() * 2));
  }
}

export function generateGrid(seed: number): TerrainId[][] {
  const rand = mulberry32(seed);

  const grid: TerrainId[][] = [];
  for (let row = 0; row < WORLD_ROWS; row++) {
    grid.push(new Array<TerrainId>(WORLD_COLS).fill(T.GROUND));
  }

  scatterBlobs(grid, rand, T.CRATER, 90, 1, 5);
  scatterBlobs(grid, rand, T.FLORA,  70, 1, 4);
  carveRidge(grid,   rand, T.LIQUID, 320);
  carveRidge(grid,   rand, T.LIQUID, 220);
  scatterBlobs(grid, rand, T.ROCK,   40, 1, 3);
  carveRidge(grid,   rand, T.ROCK,   150);
  scatterBlobs(grid, rand, T.LAVA,   14, 1, 2);

  // Rock border + void beyond it, so the world edge reads as a wall
  for (let row = 0; row < WORLD_ROWS; row++) {
    for (let col = 0; col < WORLD_COLS; col++) {
      const edge = Math.min(row, col, WORLD_ROWS - 1 - row, WORLD_COLS - 1 - col);
      if (edge < BORDER) grid[row][col] = T.ROCK;
    }
  }

  return grid;
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

  for (let row = 0; row < WORLD_ROWS; row++) {
    let startCol = 0;
    for (let col = 1; col <= WORLD_COLS; col++) {
      const same = col < WORLD_COLS && grid[row][col] === grid[row][startCol];
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
