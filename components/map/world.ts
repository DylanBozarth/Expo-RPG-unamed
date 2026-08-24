import {
  buildBoatSolidGrid,
  buildShoreMask,
  buildSolidGrid,
  buildTerrainRuns,
  buildWaterAccessMask,
  ensureLandRoute,
  findSpawn,
  findWalkableNear,
  findWaterNear,
  generateGrid,
  HOUSE_COLS,
  HOUSE_ROWS,
  pickEnemyCells,
  placeBoat,
  placeHouse,
  TILE,
  type SolidGrid,
  type TerrainId,
  type TerrainRun,
} from "./terrain";

const ENEMY_COUNT = 0;
const ENEMY_MIN_SPAWN_TILES = 8;

export const BOAT_WIDTH = TILE * 0.95;
export const BOAT_HEIGHT = TILE * 0.55;

export const FISH_WIDTH = TILE * 0.5;
export const FISH_HEIGHT = TILE * 0.26;

// ---------------------------------------------------------------------------
// World — all coordinates in world px
// ---------------------------------------------------------------------------

export interface Enemy {
  x: number;
  y: number;
}

/** House geometry in world px, resolved once at generation time. */
export interface House {
  x: number;
  y: number;
  width: number;
  height: number;
  doorX: number;
  doorY: number;
}

export interface World {
  seed: number;
  grid: TerrainId[][];
  runs: TerrainRun[];
  spawnX: number;
  spawnY: number;
  enemies: Enemy[];
  house: House;
  /** Beached by the nearest shoreline to the house. */
  boat: { x: number; y: number; width: number; height: number };
  /** Rivers block walking. Built last, after the grid stops changing. */
  solid: SolidGrid;
  /** Inverse mask: while boating, dry land blocks instead. */
  boatSolid: SolidGrid;
  /** Water tiles touching land — where a boat may be left. */
  shore: SolidGrid;
  /** Tiles within reach of water — where the player can drink. */
  waterAccess: SolidGrid;
  /** Standing a short walk from the house. */
  npc: { x: number; y: number };
  /** Swimming out in the river. */
  fish: { x: number; y: number; width: number; height: number };
}

export function generateWorld(seed: number): World {
  const grid = generateGrid(seed);
  const spawn = findSpawn(grid); // clears a pad, so run it before building runs
  const house = placeHouse(grid, spawn); // also flattens its footprint

  // Rivers are solid, so guarantee a dry route from spawn to the door before
  // freezing the collision mask — otherwise a channel can seal the house off.
  ensureLandRoute(grid, spawn, {
    col: house.doorCol,
    row: house.doorRow + 1,
  });

  const boatCell = placeBoat(grid, {
    col: house.doorCol,
    row: house.doorRow + 1,
  });

  // Kept clear of the spawn point and the boat — the NPC is solid, and one
  // standing on either would be an obstacle the player starts inside of.
  const npcCell = findWalkableNear(
    grid,
    { col: house.doorCol, row: house.doorRow + 1 },
    3,
    14,
    [spawn, boatCell]
  );

  // Out in the water, clear of the tile the boat launches from
  const fishCell = findWaterNear(
    grid,
    { col: house.doorCol, row: house.doorRow + 1 },
    2,
    24,
    [boatCell]
  );

  // Must come after findSpawn/placeHouse/ensureLandRoute — all edit the grid
  const solid = buildSolidGrid(grid);
  const boatSolid = buildBoatSolidGrid(grid);
  const shore = buildShoreMask(grid);
  const waterAccess = buildWaterAccessMask(grid);
  const cells = pickEnemyCells(
    grid,
    seed,
    ENEMY_COUNT,
    spawn,
    ENEMY_MIN_SPAWN_TILES
  );

  return {
    seed,
    grid,
    solid,
    boatSolid,
    shore,
    waterAccess,
    runs: buildTerrainRuns(grid),
    spawnX: (spawn.col + 0.5) * TILE,
    spawnY: (spawn.row + 0.5) * TILE,
    enemies: cells.map(({ col, row }) => ({
      x: (col + 0.5) * TILE,
      y: (row + 0.5) * TILE,
    })),
    npc: {
      x: (npcCell.col + 0.5) * TILE,
      y: (npcCell.row + 0.5) * TILE,
    },
    fish: {
      x: (fishCell.col + 0.5) * TILE - FISH_WIDTH / 2,
      y: (fishCell.row + 0.5) * TILE - FISH_HEIGHT / 2,
      width: FISH_WIDTH,
      height: FISH_HEIGHT,
    },
    boat: {
      x: (boatCell.col + 0.5) * TILE - BOAT_WIDTH / 2,
      y: (boatCell.row + 0.5) * TILE - BOAT_HEIGHT / 2,
      width: BOAT_WIDTH,
      height: BOAT_HEIGHT,
    },
    house: {
      x: house.col * TILE,
      y: house.row * TILE,
      width: HOUSE_COLS * TILE,
      height: HOUSE_ROWS * TILE,
      // Doorway sits on the bottom wall, centred on its tile
      doorX: (house.doorCol + 0.5) * TILE,
      doorY: (house.doorRow + 1) * TILE,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The world is generated once and held at module scope, so navigating away from
 * the map and back — or restarting a run — returns to the same place rather
 * than rolling a fresh one. Same reasoning as the vitals: this is not screen
 * state, so it can't live in a component.
 */
let current: World | null = null;

export function getWorld(): World {
  if (current === null) {
    current = generateWorld(Math.floor(Math.random() * 0xffffffff));
  }
  return current;
}

/** Explicitly discard the world and roll a new one. */
export function regenerateWorld(seed?: number): World {
  current = generateWorld(seed ?? Math.floor(Math.random() * 0xffffffff));
  return current;
}
