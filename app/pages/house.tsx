import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { buildTerrainRuns, generateRoom, TILE } from "../../components/map/terrain";
import { useMovement } from "../../components/movement/movement";
import {
  PLAYER_RADIUS,
  SceneCanvas,
  SceneControls,
  useCamera,
} from "../../components/scene/scene";
import { Colors } from "../../styling/theme";

const ROOM_COLS = 16;
const ROOM_ROWS = 12;
const ROOM_W = ROOM_COLS * TILE;
const ROOM_H = ROOM_ROWS * TILE;

/**
 * Interior map. Empty for now — it exists so the doorway leads somewhere the
 * player still has control. Pushed onto the stack, so going back restores the
 * outdoor map with its world and player position intact.
 */
export default function HouseScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();

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

  const transform = useCamera({
    playerX: movement.playerX,
    playerY: movement.playerY,
    width,
    height,
    worldWidth: ROOM_W,
    worldHeight: ROOM_H,
  });

  return (
    <View style={styles.container}>
      <SceneCanvas
        width={width}
        height={height}
        runs={runs}
        playerX={movement.playerX}
        playerY={movement.playerY}
        transform={transform}
      />

      <SceneControls movement={movement}>
        <Pressable style={styles.exitButton} onPress={() => router.back()}>
          <Text style={styles.exitText}>EXIT</Text>
        </Pressable>
      </SceneControls>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050508",
  },
  exitButton: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  exitText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
  },
});
