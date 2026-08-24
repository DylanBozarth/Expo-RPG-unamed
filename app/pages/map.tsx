import { matchFont, Path, Rect, Skia, Text as SkiaText } from "@shopify/react-native-skia";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import {
  buildTerrainRuns,
  findSpawn,
  generateGrid,
  HOUSE_COLS,
  HOUSE_ROWS,
  pickEnemyCells,
  placeHouse,
  TILE,
  WORLD_H,
  WORLD_W,
  type TerrainId,
  type TerrainRun,
} from "../../components/map/terrain";
import { useMovement } from "../../components/movement/movement";
import { resetVitals } from "../../components/vitals/vitals-state";
import {
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
/** How close the player has to be to the doorway before entry is offered. */
const DOOR_REACH = TILE * 1.4;

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
}

function generateWorld(seed: number): World {
  const grid = generateGrid(seed);
  const spawn = findSpawn(grid); // clears a pad, so run it before building runs
  const house = placeHouse(grid, spawn); // also flattens its footprint
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
  const { enemies, runs, spawnX, spawnY, house } = world;
  const router = useRouter();

  // Only true while the player stands in the doorway's reach
  const [nearDoor, setNearDoor] = useState(false);

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

  const movement = useMovement({
    screenWidth: width,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    playerRadius: PLAYER_RADIUS,
    startX: spawnX,
    startY: spawnY,
    obstacles,
  });
  const { playerX, playerY } = movement;

  const gameOver = useSharedValue(false);

  const cameraTransform = useCamera({
    playerX,
    playerY,
    width,
    height,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
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

  // Doorway proximity — the comparison runs on the UI thread and only crosses
  // to JS when the player actually enters or leaves the door's reach.
  useAnimatedReaction(
    () => {
      const dx = playerX.value - house.doorX;
      const dy = playerY.value - house.doorY;
      return dx * dx + dy * dy < DOOR_REACH * DOOR_REACH;
    },
    (near, prev) => {
      if (near !== prev) runOnJS(setNearDoor)(near);
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
        transform={cameraTransform}
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

          {/* Doorway on the bottom wall — lights up once within reach */}
          <Rect
            x={house.doorX - DOOR_WIDTH / 2}
            y={house.doorY - DOOR_HEIGHT}
            width={DOOR_WIDTH}
            height={DOOR_HEIGHT}
            color={nearDoor ? Colors.orange : "#2e1a10"}
          />

        <Path path={enemyPath} color="#e63946" />
      </SceneCanvas>

      <SceneControls movement={movement}>
        {nearDoor && (
          <Pressable
            style={styles.enterButton}
            onPress={() => router.push("/pages/house")}
          >
            <Text style={styles.enterText}>ENTER HOUSE</Text>
          </Pressable>
        )}
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
  enterButton: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  enterText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.5,
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
