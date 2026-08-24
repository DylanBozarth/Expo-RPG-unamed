import { Canvas, Circle, Group, Path, Rect, Skia } from "@shopify/react-native-skia";
import { useCallback, useMemo, useState } from "react";
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
import { Inventory } from "../../components/inventory/inventory";
import { Joystick, useMovement } from "../../components/movement/movement";
import { MAX_VITAL, VitalsHud } from "../../components/vitals/vitals";
import type { ItemUse } from "../../store/inventory-store";
import { Colors } from "../../styling/theme";

const PLAYER_RADIUS = 18;
const ENEMY_RADIUS = 14;

const ENEMY_COUNT = 0;
const ENEMY_MIN_SPAWN_TILES = 8;

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
    stamina,
    hunger,
    thirst,
    temperature,
    moveGesture,
    moveKnobStyle,
  } = useMovement({
    screenWidth: width,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    playerRadius: PLAYER_RADIUS,
    startX: spawnX,
    startY: spawnY,
  });

  const gameOver = useSharedValue(false);

  // Consuming an item tops up the matching bar. Safe to write a shared value
  // from the JS thread — Reanimated forwards it to the UI thread.
  const handleConsume = useCallback(
    (use: ItemUse) => {
      const bar = use.vital === "hunger" ? hunger : thirst;
      bar.value = Math.min(MAX_VITAL, bar.value + use.amount);
    },
    [hunger, thirst]
  );

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

          <Circle
            cx={playerX}
            cy={playerY}
            r={PLAYER_RADIUS}
            color={Colors.orange}
          />
        </Group>
      </Canvas>

      <GestureDetector gesture={moveGesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only">
          <Joystick knobStyle={moveKnobStyle} />
        </View>
      </GestureDetector>

      <VitalsHud
        stamina={stamina}
        hunger={hunger}
        thirst={thirst}
        temperature={temperature}
      />

      {/* After the GestureDetector so it sits on top and wins hit-testing —
          the joystick's absoluteFill would otherwise swallow these taps. */}
      <Inventory onConsume={handleConsume} />
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
