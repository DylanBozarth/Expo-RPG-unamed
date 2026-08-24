import {
  Canvas,
  Circle,
  Group,
  Path,
  Rect,
  Skia,
} from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  buildTerrainRuns,
  findSpawn,
  generateGrid,
  pickEnemyCells,
  T,
  TERRAIN_COLORS,
  TERRAIN_DRAW_ORDER,
  TILE,
  WORLD_H,
  WORLD_W,
  type TerrainId,
  type TerrainRun,
} from "../../components/map/terrain";
import {
  AimArrow,
  Joystick,
  useMovement,
} from "../../components/movement/movement";
import { Colors } from "../../styling/theme";

const PLAYER_RADIUS = 18;
const ENEMY_RADIUS = 14;
const PROJ_RADIUS = 6;
const PROJ_SPEED = 14;
const PROJ_LIFE = 55; // frames — caps range so shots don't fly the whole world
const MAX_PROJ = 16;

const ENEMY_COUNT = 40;
const ENEMY_MIN_SPAWN_TILES = 8;

// Struct-of-arrays so worklets can mutate in place then trigger a single assignment
interface ProjPool {
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  life: number[];
  alive: boolean[];
}

function makeProjPool(): ProjPool {
  return {
    x: new Array(MAX_PROJ).fill(0),
    y: new Array(MAX_PROJ).fill(0),
    vx: new Array(MAX_PROJ).fill(0),
    vy: new Array(MAX_PROJ).fill(0),
    life: new Array(MAX_PROJ).fill(0),
    alive: new Array(MAX_PROJ).fill(false),
  };
}

// ---------------------------------------------------------------------------
// World — regenerated per game, all coordinates in world px
// ---------------------------------------------------------------------------

interface Enemy {
  x: number;
  y: number;
}

interface World {
  grid: TerrainId[][];
  runs: TerrainRun[];
  spawnX: number;
  spawnY: number;
  enemies: Enemy[];
}

function generateWorld(seed: number): World {
  const grid = generateGrid(seed);
  const spawn = findSpawn(grid); // clears a pad, so run it before building runs
  const cells = pickEnemyCells(
    grid,
    seed,
    ENEMY_COUNT,
    spawn,
    ENEMY_MIN_SPAWN_TILES
  );

  return {
    grid,
    runs: buildTerrainRuns(grid),
    spawnX: (spawn.col + 0.5) * TILE,
    spawnY: (spawn.row + 0.5) * TILE,
    enemies: cells.map(({ col, row }) => ({
      x: (col + 0.5) * TILE,
      y: (row + 0.5) * TILE,
    })),
  };
}

// ---------------------------------------------------------------------------
// Terrain — static geometry, one Skia path per terrain type
// ---------------------------------------------------------------------------

function TerrainLayer({ runs }: { runs: TerrainRun[] }) {
  const layers = useMemo(() => {
    const byTerrain = new Map<TerrainId, ReturnType<typeof Skia.Path.Make>>();

    for (const run of runs) {
      let path = byTerrain.get(run.terrain);
      if (!path) {
        path = Skia.Path.Make();
        byTerrain.set(run.terrain, path);
      }
      path.addRect(Skia.XYWHRect(run.x, run.y, run.width, run.height));
    }

    return TERRAIN_DRAW_ORDER.filter((t) => byTerrain.has(t)).map(
      (terrain) => ({
        terrain,
        path: byTerrain.get(terrain)!,
        color: TERRAIN_COLORS[terrain],
      })
    );
  }, [runs]);

  return (
    <>
      {layers.map(({ terrain, path, color }) => (
        <Path key={terrain} path={path} color={color} />
      ))}
    </>
  );
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
  const { enemies, runs, spawnX, spawnY } = world;

  const {
    playerX,
    playerY,
    aimAngle,
    fireCount,
    combinedGesture,
    moveKnobStyle,
    aimKnobStyle,
  } = useMovement({
    screenWidth: width,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    playerRadius: PLAYER_RADIUS,
    startX: spawnX,
    startY: spawnY,
  });

  const muzzleFlash = useSharedValue(0);
  const gameOver = useSharedValue(false);
  const projPool = useSharedValue<ProjPool>(makeProjPool());
  const enemyAlive = useSharedValue<boolean[]>(enemies.map(() => true));

  // ---------------------------------------------------------------------------
  // Camera — centre on the player, clamped to the world edges
  // ---------------------------------------------------------------------------
  const maxCamX = Math.max(0, WORLD_W - width);
  const maxCamY = Math.max(0, WORLD_H - height);

  const cameraTransform = useDerivedValue(() => {
    const camX = Math.max(0, Math.min(maxCamX, playerX.value - width / 2));
    const camY = Math.max(0, Math.min(maxCamY, playerY.value - height / 2));
    return [{ translateX: -camX }, { translateY: -camY }];
  });

  // ---------------------------------------------------------------------------
  // Game loop — projectile physics + all collision
  // ---------------------------------------------------------------------------
  useFrameCallback(() => {
    "worklet";
    if (gameOver.value) return;

    const pool = projPool.value;
    const alive = enemyAlive.value;
    let projDirty = false;
    let enemyDirty = false;

    // Move projectiles + collision vs enemies
    for (let i = 0; i < MAX_PROJ; i++) {
      if (!pool.alive[i]) continue;

      const nx = pool.x[i] + pool.vx[i];
      const ny = pool.y[i] + pool.vy[i];

      // Out of world or out of range — retire
      pool.life[i] -= 1;
      if (
        pool.life[i] <= 0 ||
        nx < 0 ||
        nx > WORLD_W ||
        ny < 0 ||
        ny > WORLD_H
      ) {
        pool.alive[i] = false;
        projDirty = true;
        continue;
      }

      pool.x[i] = nx;
      pool.y[i] = ny;
      projDirty = true;

      // Check vs each live enemy
      for (let j = 0; j < enemies.length; j++) {
        if (!alive[j]) continue;
        const dx = nx - enemies[j].x;
        const dy = ny - enemies[j].y;
        if (dx * dx + dy * dy < (PROJ_RADIUS + ENEMY_RADIUS) ** 2) {
          pool.alive[i] = false;
          alive[j] = false;
          enemyDirty = true;
          break;
        }
      }
    }

    if (projDirty) projPool.value = { ...pool };
    if (enemyDirty) enemyAlive.value = [...alive];

    // Player vs live enemy — game over
    for (let i = 0; i < enemies.length; i++) {
      if (!alive[i]) continue;
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

  // Spawn projectile + muzzle flash on each fire tap
  useAnimatedReaction(
    () => fireCount.value,
    (count, prev) => {
      if (count === prev || gameOver.value) return;

      muzzleFlash.value = 1;
      muzzleFlash.value = withTiming(0, { duration: 120 });

      const pool = projPool.value;
      for (let i = 0; i < MAX_PROJ; i++) {
        if (pool.alive[i]) continue;
        const angle = aimAngle.value;
        pool.x[i] = playerX.value;
        pool.y[i] = playerY.value;
        pool.vx[i] = Math.cos(angle) * PROJ_SPEED;
        pool.vy[i] = Math.sin(angle) * PROJ_SPEED;
        pool.life[i] = PROJ_LIFE;
        pool.alive[i] = true;
        projPool.value = { ...pool };
        break;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Reactive Skia paths — built on UI thread, read by Canvas directly
  // ---------------------------------------------------------------------------
  const enemyPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const alive = enemyAlive.value;
    for (let i = 0; i < enemies.length; i++) {
      if (alive[i]) path.addCircle(enemies[i].x, enemies[i].y, ENEMY_RADIUS);
    }
    return path;
  });

  const projPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const pool = projPool.value;
    for (let i = 0; i < MAX_PROJ; i++) {
      if (pool.alive[i]) path.addCircle(pool.x[i], pool.y[i], PROJ_RADIUS);
    }
    return path;
  });

  // ---------------------------------------------------------------------------
  // Render — everything world-space lives inside the camera Group
  // ---------------------------------------------------------------------------
  return (
    <>
      <Canvas style={{ width, height }}>
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          color={TERRAIN_COLORS[T.VOID]}
        />

        <Group transform={cameraTransform}>
          <TerrainLayer runs={runs} />

          <Path path={enemyPath} color="#e63946" />
          <Path path={projPath} color="#4cc9f0" />

          <AimArrow
            playerX={playerX}
            playerY={playerY}
            aimAngle={aimAngle}
            playerRadius={PLAYER_RADIUS}
            muzzleFlash={muzzleFlash}
          />
          <Circle
            cx={playerX}
            cy={playerY}
            r={PLAYER_RADIUS}
            color={Colors.orange}
          />
        </Group>
      </Canvas>

      <GestureDetector gesture={combinedGesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only">
          <Joystick side="left" knobStyle={moveKnobStyle} />
          <Joystick side="right" knobStyle={aimKnobStyle} />
        </View>
      </GestureDetector>
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
