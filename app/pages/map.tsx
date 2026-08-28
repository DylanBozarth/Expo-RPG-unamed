import {
  Circle,
  matchFont,
  Oval,
  Path,
  Rect,
  Skia,
  Text as SkiaText,
} from "@shopify/react-native-skia";
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
  nearestWalkableTile,
  nearestWaterTile,
  TILE,
  WORLD_H,
  WORLD_W,
} from "../../components/map/terrain";
import {
  BOAT_HEIGHT,
  BOAT_WIDTH,
  getWorld,
  type World,
} from "../../components/map/world";
import {
  GroundItemLayer,
  useNearestGroundItem,
} from "../../components/ground/ground";
import { useMovement } from "../../components/movement/movement";
import {
  Interactable,
  isTapOn,
  useNearby,
} from "../../components/scene/interactable";
import { DialogBox } from "../../components/scene/dialog";
import { StatSheet } from "../../components/character/stat-sheet";
import { drink, eat, resetVitals } from "../../components/vitals/vitals-state";
import { MAX_VITAL } from "../../components/vitals/vitals";
import {
  ActionBar,
  ActionButton,
  PLAYER_RADIUS,
  SceneCanvas,
  SceneControls,
  useCamera,
} from "../../components/scene/scene";
import { useGroundStore, type SceneId } from "../../store/ground-store";
import { Colors } from "../../styling/theme";

const ENEMY_RADIUS = 14;

/** Identifies this map to the ground store — piles belong to one map only. */
const SCENE: SceneId = "map";

const DOOR_WIDTH = TILE * 0.6;
const DOOR_HEIGHT = TILE * 0.35;

const BOAT_COLOR = "#d9a066";

const FISH_COLOR = "#cfd8dc";
/** One fish is half a meal. */
const FISH_NUTRITION = MAX_VITAL / 2;

const NPC_RADIUS = 15;
const NPC_NAME = "NPC";
const NPC_LINE = "Hello.";

const HOUSE_LABEL = "HOUSE";
const houseFont = matchFont({ fontSize: 22, fontWeight: "700" });

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
  const { enemies, runs, spawnX, spawnY, house, solid, boat, npc, fish } =
    world;
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

  // The NPC is solid. A circle, not the square its sprite bounds would give.
  const circleObstacles = useMemo(
    () => [{ x: npc.x, y: npc.y, radius: NPC_RADIUS }],
    [npc]
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

  const npcRect = useMemo(
    () => ({
      x: npc.x - NPC_RADIUS,
      y: npc.y - NPC_RADIUS,
      width: NPC_RADIUS * 2,
      height: NPC_RADIUS * 2,
    }),
    [npc]
  );

  // Talking freezes the player. Mirrored as a shared value for the movement
  // worklet and as React state for the dialog box.
  const [talking, setTalking] = useState(false);
  const lockedFlag = useSharedValue(false);

  const startTalking = useCallback(() => {
    setTalking(true);
    lockedFlag.value = true;
  }, [lockedFlag]);

  const stopTalking = useCallback(() => {
    setTalking(false);
    lockedFlag.value = false;
  }, [lockedFlag]);

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
    circleObstacles,
    solid,
    altSolid: boatSolid,
    useAltSolid: boardedFlag,
    locked: lockedFlag,
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
  const nearNpc = useNearby(playerX, playerY, npcRect);

  const [fishEaten, setFishEaten] = useState(false);
  const nearFish = useNearby(playerX, playerY, fish);

  // Dropped items: the nearest pile in reach can be picked back up
  const nearGroundKey = useNearestGroundItem(playerX, playerY, SCENE);
  const pickUpGround = useGroundStore((s) => s.pickUp);
  const pickUp = useCallback(() => {
    if (nearGroundKey !== null) pickUpGround(nearGroundKey);
  }, [nearGroundKey, pickUpGround]);

  const eatFish = useCallback(() => {
    eat(FISH_NUTRITION);
    setFishEaten(true);
  }, []);

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
      if (talking) return; // conversation owns the input

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
      talking,
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

        {!fishEaten && (
          <Oval
            x={fish.x}
            y={fish.y}
            width={fish.width}
            height={fish.height}
            color={FISH_COLOR}
          />
        )}

        <Circle cx={npc.x} cy={npc.y} r={NPC_RADIUS} color={Colors.white} />

        <Path path={enemyPath} color="#e63946" />

        {/* Dropped items, named in text until they have sprites */}
        <GroundItemLayer scene={SCENE} nearKey={nearGroundKey} />
      </SceneCanvas>

      <SceneControls
        movement={movement}
        onTap={handleTap}
        scene={SCENE}
        camera={camera}
      >
        {!talking && (
          <ActionBar>
            {nearNpc && !boarded && (
              <ActionButton label="SPEAK" onPress={startTalking} />
            )}
            {/* Offered afloat too, or anything dropped on the water would be
                stranded there for good */}
            {nearGroundKey !== null && (
              <ActionButton label="PICK UP" onPress={pickUp} />
            )}
            {nearFish && !fishEaten && (
              <ActionButton label="EAT" onPress={eatFish} />
            )}
            {nearWater && <ActionButton label="DRINK" onPress={drink} />}
            {boarded && canLeaveBoat && (
              <ActionButton label="DISEMBARK" onPress={disembark} />
            )}
          </ActionBar>
        )}
      </SceneControls>

      {talking && (
        <DialogBox speaker={NPC_NAME} line={NPC_LINE} onClose={stopTalking}>
          {/* The stats are only shown here, in conversation — the HUD stays
              clear the rest of the time */}
          <StatSheet />
        </DialogBox>
      )}
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
  // Generated once at module scope, so remounting this screen does not reroll it
  const world = getWorld();

  function handleGameOver() {
    setIsGameOver(true);
  }

  function restart() {
    // Vitals live at module scope now, so remounting no longer clears them —
    // a new run has to say so explicitly.
    resetVitals();
    setIsGameOver(false);
    // Same world — a restart resets the run, not the map
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
