import { Rect } from "@shopify/react-native-skia";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { buildTerrainRuns, generateRoom, TILE } from "../../components/map/terrain";
import { useMovement } from "../../components/movement/movement";
import {
  Interactable,
  isTapOn,
  useNearby,
} from "../../components/scene/interactable";
import {
  ActionBar,
  ActionButton,
  PLAYER_RADIUS,
  SceneCanvas,
  SceneControls,
  useCamera,
} from "../../components/scene/scene";
import { sleep } from "../../components/vitals/vitals-state";
import { Colors } from "../../styling/theme";

const ROOM_COLS = 16;
const ROOM_ROWS = 12;
const ROOM_W = ROOM_COLS * TILE;
const ROOM_H = ROOM_ROWS * TILE;

/** Bed, tucked into the top-left corner of the floor. */
const BED = {
  x: TILE * 1.5,
  y: TILE * 1.5,
  width: TILE * 2,
  height: TILE * 3,
};

/** How close to the bed before sleeping is offered. */
const BED_REACH = TILE * 1.4;

/**
 * The way out, set into the bottom wall so it lines up with where the player
 * walks in. Spans the wall's full thickness.
 */
const EXIT_DOOR = {
  x: ROOM_W / 2 - TILE * 0.5,
  y: ROOM_H - TILE,
  width: TILE,
  height: TILE,
};

/**
 * Interior map. Pushed onto the stack, so going back restores the outdoor map
 * with its world and player position intact.
 */
export default function HouseScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();

  const [nearBed, setNearBed] = useState(false);

  const runs = useMemo(
    () => buildTerrainRuns(generateRoom(ROOM_COLS, ROOM_ROWS)),
    []
  );

  // Enter standing just inside the bottom wall, where the door would be
  const movement = useMovement({
    screenWidth: width,
    worldWidth: ROOM_W,
    worldHeight: ROOM_H,
    playerRadius: PLAYER_RADIUS,
    startX: ROOM_W / 2,
    startY: ROOM_H - TILE * 1.5,
  });
  const { playerX, playerY } = movement;

  const camera = useCamera({
    playerX,
    playerY,
    width,
    height,
    worldWidth: ROOM_W,
    worldHeight: ROOM_H,
  });

  const nearExit = useNearby(playerX, playerY, EXIT_DOOR);

  // Tap arrives in canvas coords; shift by the camera to get world coords
  const handleTap = useCallback(
    (x: number, y: number) => {
      if (!nearExit) return;
      const worldX = x + camera.camX.value;
      const worldY = y + camera.camY.value;
      if (isTapOn(worldX, worldY, EXIT_DOOR)) router.back();
    },
    [nearExit, camera, router]
  );

  // Distance to the nearest point on the bed rather than its centre, so the
  // whole length of the bed is approachable. Runs on the UI thread and only
  // crosses to JS when the player enters or leaves reach.
  useAnimatedReaction(
    () => {
      const nx = Math.max(BED.x, Math.min(playerX.value, BED.x + BED.width));
      const ny = Math.max(BED.y, Math.min(playerY.value, BED.y + BED.height));
      const dx = playerX.value - nx;
      const dy = playerY.value - ny;
      return dx * dx + dy * dy < BED_REACH * BED_REACH;
    },
    (near, prev) => {
      if (near !== prev) runOnJS(setNearBed)(near);
    }
  );

  return (
    <View style={styles.container}>
      <SceneCanvas
        width={width}
        height={height}
        runs={runs}
        playerX={playerX}
        playerY={playerY}
        transform={camera.transform}
      >
        <Rect
          x={BED.x}
          y={BED.y}
          width={BED.width}
          height={BED.height}
          color={Colors.white}
        />

        {/* Prompt above the door — below it is outside the room */}
        <Interactable rect={EXIT_DOOR} active={nearExit} promptSide="above" />
      </SceneCanvas>

      <SceneControls movement={movement} onTap={handleTap}>
        <ActionBar>
          {nearBed && <ActionButton label="SLEEP" onPress={sleep} />}
        </ActionBar>
      </SceneControls>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050508",
  },
});
