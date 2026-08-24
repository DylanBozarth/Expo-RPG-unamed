import { Canvas, Circle, Group, Path, Rect, Skia } from "@shopify/react-native-skia";
import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
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

/**
 * Follows the player, clamped to the world edges. When an axis of the world is
 * smaller than the viewport — which interiors usually are — that axis is
 * centred instead, so a small map doesn't sit pinned to the top-left corner.
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

  return useDerivedValue(() => {
    const camX =
      maxCamX <= 0 ? maxCamX / 2 : Math.max(0, Math.min(maxCamX, playerX.value - width / 2));
    const camY =
      maxCamY <= 0 ? maxCamY / 2 : Math.max(0, Math.min(maxCamY, playerY.value - height / 2));
    return [{ translateX: -camX }, { translateY: -camY }];
  });
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
  transform: ReturnType<typeof useCamera>;
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
// SceneControls — joystick, vitals, inventory. Identical on every map.
// ---------------------------------------------------------------------------

interface SceneControlsProps {
  movement: MovementApi;
  /** Extra screen-space UI, rendered above the controls. */
  children?: ReactNode;
}

export function SceneControls({ movement, children }: SceneControlsProps) {
  const { hunger, thirst } = movement;

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
      <GestureDetector gesture={movement.moveGesture}>
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
