import { matchFont, Path, Rect, Skia, Text as SkiaText } from "@shopify/react-native-skia";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import {
  buildBoatSolidGrid,
  buildShoreMask,
  buildSolidGrid,
  buildTerrainRuns,
  buildWaterAccessMask,
  ensureLandRoute,
  findSpawn,
  nearestWalkableTile,
  nearestWaterTile,
  generateGrid,
  HOUSE_COLS,
  HOUSE_ROWS,
  pickEnemyCells,
  placeBoat,
  placeHouse,
  TILE,
  WORLD_H,
  WORLD_W,
  type SolidGrid,
  type TerrainId,
  type TerrainRun,
} from "../../components/map/terrain";
import { useMovement } from "../../components/movement/movement";
import {
  Interactable,
  isTapOn,
  useNearby,
} from "../../components/scene/interactable";
import { drink, resetVitals } from "../../components/vitals/vitals-state";
import {
  ActionBar,
  ActionButton,
  PLAYER_RADIUS,
  SceneCanvas,
  SceneControls,
  useCamera,
} from "../../components/scene/scene";
import { Colors } from "../../styling/theme";

const ENEMY_RADIUS = 14;

const ENEMY_COUNT = 0;
const ENEMY_MIN_SPAWN_TILES = 8;

const DOOR_WIDTH = TILE * 0.6;
const DOOR_HEIGHT = TILE * 0.35;

const BOAT_WIDTH = TILE * 0.95;
const BOAT_HEIGHT = TILE * 0.55;
const BOAT_COLOR = "#d9a066";

const HOUSE_LABEL = "HOUSE";
const houseFont = matchFont({ fontSize: 22, fontWeight: "700" });

// ---------------------------------------------------------------------------
// World — regenerated per game, all coordinates in world px
// ---------------------------------------------------------------------------

interface Enemy {
  x: number;
  y: number;
}

/** House geometry in world px, resolved once at generation time. */
interface House {
  x: number;
  y: number;
  width: number;
  height: number;
  doorX: number;
  doorY: number;
}

interface World {
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
}

function generateWorld(seed: number): World {
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
// GameContent — remounted on restart via key prop
// ---------------------------------------------------------------------------

interface GameContentProps {
  width: number;
  height: number;
  world: World;
  onGameOver: () => void;
}

function GameContent({ width, height, world, onGameOver }: GameContentProps) {
  const { enemies, runs, spawnX, spawnY, house, solid, boat } = world;
  const { grid, boatSolid, shore, waterAccess } = world;
  const router = useRouter();

  const doorRect = useMemo(
    () => ({
      x: house.doorX - DOOR_WIDTH / 2,
      y: house.doorY - DOOR_HEIGHT,
      width: DOOR_WIDTH,
      height: DOOR_HEIGHT,
    }),
    [house]
  );

  // The house is solid. Memoised because the frame callback closes over it.
  const obstacles = useMemo(
    () => [
      {
        x: house.x,
        y: house.y,
        width: house.width,
        height: house.height,
      },
    ],
    [house]
  );

  // Aboard the boat, water stops blocking. Mirrored as a shared value because
  // the collision check runs in the movement worklet, and as React state
  // because the boat's rendering depends on it.
  const [boarded, setBoarded] = useState(false);
  const boardedFlag = useSharedValue(false);

  // Where the boat is moored. Starts beached by the house and thereafter stays
  // wherever it was last left, so it has to be state rather than world data.
  const [mooring, setMooring] = useState(boat);

  const movement = useMovement({
    screenWidth: width,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    playerRadius: PLAYER_RADIUS,
    startX: spawnX,
    startY: spawnY,
    obstacles,
    solid,
    altSolid: boatSolid,
    useAltSolid: boardedFlag,
  });
  const { playerX, playerY } = movement;

  const gameOver = useSharedValue(false);

  const camera = useCamera({
    playerX,
    playerY,
    width,
    height,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
  });

  const nearDoor = useNearby(playerX, playerY, doorRect);
  const nearBoat = useNearby(playerX, playerY, mooring);

  // While aboard, the boat rides with the player
  const boatX = useDerivedValue(() => playerX.value - BOAT_WIDTH / 2);
  const boatY = useDerivedValue(() => playerY.value - BOAT_HEIGHT / 2);

  // A boat can only be left where the water touches land. Precomputed as a
  // mask, so this is one array lookup per frame on the UI thread.
  const [canLeaveBoat, setCanLeaveBoat] = useState(false);
  useAnimatedReaction(
    () => {
      const col = Math.floor(playerX.value / shore.tile);
      const row = Math.floor(playerY.value / shore.tile);
      if (col < 0 || row < 0 || col >= shore.cols || row >= shore.rows) {
        return false;
      }
      return shore.cells[row * shore.cols + col] === 1;
    },
    (atShore, prev) => {
      if (atShore !== prev) runOnJS(setCanLeaveBoat)(atShore);
    }
  );

  // Drinkable while on the bank or afloat — the mask covers both.
  const [nearWater, setNearWater] = useState(false);
  useAnimatedReaction(
    () => {
      const col = Math.floor(playerX.value / waterAccess.tile);
      const row = Math.floor(playerY.value / waterAccess.tile);
      if (
        col < 0 ||
        row < 0 ||
        col >= waterAccess.cols ||
        row >= waterAccess.rows
      ) {
        return false;
      }
      return waterAccess.cells[row * waterAccess.cols + col] === 1;
    },
    (atWater, prev) => {
      if (atWater !== prev) runOnJS(setNearWater)(atWater);
    }
  );

  // Snap back onto the bank: the walking mask makes water solid again, so the
  // player cannot be left floating on it.
  const disembark = useCallback(() => {
    const col = Math.floor(playerX.value / TILE);
    const row = Math.floor(playerY.value / TILE);
    const landing = nearestWalkableTile(grid, col, row);
    if (!landing) return;

    // Moor it on the tile being stepped off, snapped to the grid like the
    // player is, so re-boarding lines the two of them back up exactly.
    setMooring({
      x: (col + 0.5) * TILE - BOAT_WIDTH / 2,
      y: (row + 0.5) * TILE - BOAT_HEIGHT / 2,
      width: BOAT_WIDTH,
      height: BOAT_HEIGHT,
    });

    playerX.value = (landing.col + 0.5) * TILE;
    playerY.value = (landing.row + 0.5) * TILE;
    setBoarded(false);
    boardedFlag.value = false;
  }, [grid, playerX, playerY, boardedFlag]);

  // Tap arrives in canvas coords; shift by the camera to get world coords.
  // Everything is gated on proximity, so distant taps do nothing.
  const handleTap = useCallback(
    (x: number, y: number) => {
      const worldX = x + camera.camX.value;
      const worldY = y + camera.camY.value;

      // Aboard, there is nothing in the world to tap — leaving is a button
      if (boarded) return;

      if (nearDoor && isTapOn(worldX, worldY, doorRect)) {
        router.push("/pages/house");
        return;
      }

      // Snap onto the water: the boat mask makes land solid the instant this
      // flips, so staying beached would block every direction.
      if (nearBoat && isTapOn(worldX, worldY, mooring)) {
        // Search from the boat's tile, not the player's. Ring 0 is that tile,
        // so an already-afloat boat launches exactly where it sits, while one
        // beached on the bank finds the water beside it.
        const col = Math.floor((mooring.x + mooring.width / 2) / TILE);
        const row = Math.floor((mooring.y + mooring.height / 2) / TILE);
        const launch = nearestWaterTile(grid, col, row);
        if (!launch) return; // no water to push off into

        playerX.value = (launch.col + 0.5) * TILE;
        playerY.value = (launch.row + 0.5) * TILE;
        setBoarded(true);
        boardedFlag.value = true;
      }
    },
    [
      boarded,
      boardedFlag,
      nearDoor,
      nearBoat,
      camera,
      doorRect,
      mooring,
      grid,
      playerX,
      playerY,
      router,
    ]
  );

  // ---------------------------------------------------------------------------
  // Game loop — player vs enemy collision
  // ---------------------------------------------------------------------------
  useFrameCallback(() => {
    "worklet";
    if (gameOver.value) return;

    for (let i = 0; i < enemies.length; i++) {
      const dx = playerX.value - enemies[i].x;
      const dy = playerY.value - enemies[i].y;
      if (dx * dx + dy * dy < (PLAYER_RADIUS + ENEMY_RADIUS) ** 2) {
        gameOver.value = true;
        return;
      }
    }
  });

  // Bridge game-over to JS thread
  useAnimatedReaction(
    () => gameOver.value,
    (hit) => {
      if (hit) runOnJS(onGameOver)();
    }
  );

  // Centre the "HOUSE" label in the footprint. measureText is sync, so this
  // only needs recomputing if the house moves.
  const label = useMemo(() => {
    const metrics = houseFont.measureText(HOUSE_LABEL);
    return {
      x: house.x + (house.width - metrics.width) / 2,
      y: house.y + house.height / 2 + metrics.height / 2,
    };
  }, [house]);

  // Enemies are static now that nothing can kill them — build the path once
  const enemyPath = useMemo(() => {
    const path = Skia.Path.Make();
    for (const enemy of enemies) {
      path.addCircle(enemy.x, enemy.y, ENEMY_RADIUS);
    }
    return path;
  }, [enemies]);

  // ---------------------------------------------------------------------------
  // Render — everything world-space lives inside the camera Group
  // ---------------------------------------------------------------------------
  return (
    <>
      <SceneCanvas
        width={width}
        height={height}
        runs={runs}
        playerX={playerX}
        playerY={playerY}
        transform={camera.transform}
      >
        {/* House — placeholder text plus an outline, so the door has a wall
            to sit on. Real geometry replaces this later. */}
        <Rect
            x={house.x}
            y={house.y}
            width={house.width}
            height={house.height}
            color="rgba(20, 33, 61, 0.85)"
          />
          <Rect
            x={house.x}
            y={house.y}
            width={house.width}
            height={house.height}
            color={Colors.alabaster}
            style="stroke"
            strokeWidth={3}
          />
          <SkiaText
            x={label.x}
            y={label.y}
            text={HOUSE_LABEL}
            font={houseFont}
            color={Colors.alabaster}
          />

        {/* Doorway on the bottom wall — highlights and prompts once in reach.
            Prompt sits below it, on the side the player approaches from. */}
        <Interactable rect={doorRect} active={nearDoor} promptSide="below" />

        {/* Boat: beached and tappable until boarded, then it rides along */}
        {boarded ? (
          <Rect
            x={boatX}
            y={boatY}
            width={BOAT_WIDTH}
            height={BOAT_HEIGHT}
            color={BOAT_COLOR}
          />
        ) : (
          <Interactable
            rect={mooring}
            active={nearBoat}
            prompt="TAP TO BOARD"
            color={BOAT_COLOR}
            promptSide="below"
          />
        )}

        <Path path={enemyPath} color="#e63946" />
      </SceneCanvas>

      <SceneControls movement={movement} onTap={handleTap}>
        <ActionBar>
          {nearWater && <ActionButton label="DRINK" onPress={drink} />}
          {boarded && canLeaveBoat && (
            <ActionButton label="DISEMBARK" onPress={disembark} />
          )}
        </ActionBar>
      </SceneControls>
    </>
  );
}

// ---------------------------------------------------------------------------
// Game Over overlay
// ---------------------------------------------------------------------------

function GameOverScreen({ onRestart }: { onRestart: () => void }) {
  return (
    <View style={goStyles.overlay}>
      <Text style={goStyles.title}>GAME OVER</Text>
      <Pressable style={goStyles.button} onPress={onRestart}>
        <Text style={goStyles.buttonText}>Restart</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// MapScreen — root
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  const [gameKey, setGameKey] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [seed, setSeed] = useState(() =>
    Math.floor(Math.random() * 0xffffffff)
  );

  const world = useMemo(() => generateWorld(seed), [seed]);

  function handleGameOver() {
    setIsGameOver(true);
  }

  function restart() {
    // Vitals live at module scope now, so remounting no longer clears them —
    // a new run has to say so explicitly.
    resetVitals();
    setIsGameOver(false);
    setSeed(Math.floor(Math.random() * 0xffffffff));
    setGameKey((k) => k + 1);
  }

  return (
    <View style={styles.container}>
      <GameContent
        key={gameKey}
        width={width}
        height={height}
        world={world}
        onGameOver={handleGameOver}
      />
      {isGameOver && <GameOverScreen onRestart={restart} />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050508",
  },
});

const goStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 8, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  title: {
    color: "#e63946",
    fontSize: 52,
    fontWeight: "900",
    letterSpacing: 6,
  },
  button: {
    backgroundColor: Colors.orange,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 10,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
