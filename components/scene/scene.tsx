import { Canvas, Circle, Group, Path, Rect, Skia } from "@shopify/react-native-skia";
import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  runOnJS,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { Inventory } from "../inventory/inventory";
import {
  T,
  TERRAIN_COLORS,
  TERRAIN_DRAW_ORDER,
  type TerrainId,
  type TerrainRun,
} from "../map/terrain";
import { Joystick, type MovementApi } from "../movement/movement";
import { MAX_VITAL, VitalsHud } from "../vitals/vitals";
import type { ItemUse } from "../../store/inventory-store";
import { Colors } from "../../styling/theme";

export const PLAYER_RADIUS = 18;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

interface CameraOptions {
  playerX: SharedValue<number>;
  playerY: SharedValue<number>;
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
}

export interface Camera {
  transform: ReturnType<typeof useDerivedValue<{ translateX: number }[]>>;
  /** Camera offset in world px — add to a screen point to get a world point. */
  camX: SharedValue<number>;
  camY: SharedValue<number>;
}

/**
 * Follows the player, clamped to the world edges. When an axis of the world is
 * smaller than the viewport — which interiors usually are — that axis is
 * centred instead, so a small map doesn't sit pinned to the top-left corner.
 *
 * camX/camY are exposed separately so callers can map a tap back into world
 * space, which the transform alone can't do.
 */
export function useCamera({
  playerX,
  playerY,
  width,
  height,
  worldWidth,
  worldHeight,
}: CameraOptions) {
  const maxCamX = worldWidth - width;
  const maxCamY = worldHeight - height;

  const camX = useDerivedValue(() =>
    maxCamX <= 0
      ? maxCamX / 2
      : Math.max(0, Math.min(maxCamX, playerX.value - width / 2))
  );
  const camY = useDerivedValue(() =>
    maxCamY <= 0
      ? maxCamY / 2
      : Math.max(0, Math.min(maxCamY, playerY.value - height / 2))
  );

  const transform = useDerivedValue(() => [
    { translateX: -camX.value },
    { translateY: -camY.value },
  ]);

  return { transform, camX, camY };
}

// ---------------------------------------------------------------------------
// Terrain — static geometry, one Skia path per terrain type
// ---------------------------------------------------------------------------

export function TerrainLayer({ runs }: { runs: TerrainRun[] }) {
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

    return TERRAIN_DRAW_ORDER.filter((t) => byTerrain.has(t)).map((terrain) => ({
      terrain,
      path: byTerrain.get(terrain)!,
      color: TERRAIN_COLORS[terrain],
    }));
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
// SceneCanvas — terrain, scene content, and the player, under one camera
// ---------------------------------------------------------------------------

interface SceneCanvasProps {
  width: number;
  height: number;
  runs: TerrainRun[];
  playerX: SharedValue<number>;
  playerY: SharedValue<number>;
  transform: ReturnType<typeof useCamera>["transform"];
  /** World-space Skia content, drawn over the terrain and under the player. */
  children?: ReactNode;
}

export function SceneCanvas({
  width,
  height,
  runs,
  playerX,
  playerY,
  transform,
  children,
}: SceneCanvasProps) {
  return (
    <Canvas style={{ width, height }}>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        color={TERRAIN_COLORS[T.VOID]}
      />

      <Group transform={transform}>
        <TerrainLayer runs={runs} />
        {children}
        <Circle
          cx={playerX}
          cy={playerY}
          r={PLAYER_RADIUS}
          color={Colors.orange}
        />
      </Group>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Buttons of opportunity — bottom-right, context-dependent actions
// ---------------------------------------------------------------------------

/**
 * Slot for actions that are only available in the moment: disembark, sleep,
 * and whatever comes next. Bottom-right, mirroring the joystick's inset on the
 * left. Render it inside SceneControls so it sits above the gesture layer.
 */
export function ActionBar({ children }: { children?: ReactNode }) {
  return <View style={actionStyles.bar}>{children}</View>;
}

export function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={actionStyles.button} onPress={onPress}>
      <Text style={actionStyles.label}>{label}</Text>
    </Pressable>
  );
}

const actionStyles = StyleSheet.create({
  bar: {
    position: "absolute",
    right: 32,
    bottom: 48,
    alignItems: "flex-end",
    gap: 10,
  },
  button: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 26,
  },
  label: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
});

// ---------------------------------------------------------------------------
// SceneControls — joystick, vitals, inventory. Identical on every map.
// ---------------------------------------------------------------------------

interface SceneControlsProps {
  movement: MovementApi;
  /**
   * Tap position in canvas coordinates. Composed into the joystick's own
   * detector rather than layered over it — a second full-screen detector on
   * top would win hit-testing and swallow the joystick entirely.
   */
  onTap?: (x: number, y: number) => void;
  /** Extra screen-space UI, rendered above the controls. */
  children?: ReactNode;
}

export function SceneControls({
  movement,
  onTap,
  children,
}: SceneControlsProps) {
  const { hunger, thirst } = movement;

  const gesture = useMemo(() => {
    if (!onTap) return movement.moveGesture;

    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, success) => {
        "worklet";
        if (success) runOnJS(onTap)(e.x, e.y);
      });

    return Gesture.Simultaneous(movement.moveGesture, tap);
  }, [movement.moveGesture, onTap]);

  // Consuming an item tops up the matching bar. Safe to write a shared value
  // from the JS thread — Reanimated forwards it to the UI thread.
  const handleConsume = useCallback(
    (use: ItemUse) => {
      const bar = use.vital === "hunger" ? hunger : thirst;
      bar.value = Math.min(MAX_VITAL, bar.value + use.amount);
    },
    [hunger, thirst]
  );

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only">
          <Joystick knobStyle={movement.moveKnobStyle} />
        </View>
      </GestureDetector>

      <VitalsHud
        stamina={movement.stamina}
        hunger={movement.hunger}
        thirst={movement.thirst}
        temperature={movement.temperature}
      />

      {/* After the GestureDetector so these win hit-testing — the joystick's
          absoluteFill would otherwise swallow the taps. */}
      <Inventory onConsume={handleConsume} />
      {children}
    </>
  );
}
