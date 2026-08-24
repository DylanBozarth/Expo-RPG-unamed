import { useMemo } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { AnimatedStyle } from "react-native-reanimated";
import {
  EXHAUSTED_SPEED,
  HUNGER_DRAIN,
  RECOVER_THRESHOLD,
  RUN_THRESHOLD,
  RUN_UPKEEP_MULTIPLIER,
  STAMINA_RUN_DRAIN,
  THIRST_DRAIN,
} from "../vitals/vitals";
import {
  exhausted,
  hunger,
  stamina,
  temperature,
  thirst,
} from "../vitals/vitals-state";
import { Colors } from "../../styling/theme";

const PLAYER_SPEED = 3.2;
const JOYSTICK_BASE_RADIUS = 52;
const JOYSTICK_KNOB_RADIUS = 22;

/** A solid, axis-aligned box in world px that the player can't walk into. */
export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Stable identity, so passing no obstacles doesn't rebuild the frame callback
const NO_OBSTACLES: Obstacle[] = [];

/** Circle-vs-rect overlap: nearest point on the box, then a radius test. */
function hitsObstacle(
  px: number,
  py: number,
  radius: number,
  o: Obstacle
): boolean {
  "worklet";
  const nearestX = Math.max(o.x, Math.min(px, o.x + o.width));
  const nearestY = Math.max(o.y, Math.min(py, o.y + o.height));
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

// ---------------------------------------------------------------------------
// Hook — owns all movement state and the game loop
// ---------------------------------------------------------------------------

export interface MovementOptions {
  /** Viewport width — the joystick only claims touches in the left half. */
  screenWidth: number;
  /** Playfield bounds in world px — the player is clamped to these. */
  worldWidth: number;
  worldHeight: number;
  playerRadius: number;
  /** Starting position in world px. */
  startX: number;
  startY: number;
  /** Solid boxes the player is kept out of. Must be referentially stable. */
  obstacles?: Obstacle[];
}

export type MovementApi = ReturnType<typeof useMovement>;

export function useMovement({
  screenWidth,
  worldWidth,
  worldHeight,
  playerRadius,
  startX,
  startY,
  obstacles = NO_OBSTACLES,
}: MovementOptions) {
  const playerX = useSharedValue(startX);
  const playerY = useSharedValue(startY);
  const dirX = useSharedValue(0);
  const dirY = useSharedValue(0);

  const moveKnobOffX = useSharedValue(0);
  const moveKnobOffY = useSharedValue(0);

  // Vitals are player state, not scene state — they come from module scope so
  // they carry across maps instead of resetting on every screen change.

  // Per-pointer tracking — the joystick owns one finger at a time
  const movePointerID = useSharedValue(-1);
  const moveStartX = useSharedValue(0);
  const moveStartY = useSharedValue(0);

  const halfWidth = screenWidth / 2;

  // Game loop — runs every frame on the UI thread
  useFrameCallback(() => {
    "worklet";
    // dirX/dirY already carry the stick magnitude, so this is 0..1
    const effort = Math.sqrt(
      dirX.value * dirX.value + dirY.value * dirY.value
    );
    const running = effort > RUN_THRESHOLD && !exhausted.value;

    // Stamina: running spends it and nothing here gives it back — standing
    // still does not refill the bar. Walking is free, so it's the sustainable
    // way to travel once the bar runs low.
    if (running) {
      // Scaled by effort so stamina behaves like a distance budget — a jog just
      // above the threshold isn't punished at the same rate as a flat sprint.
      const stam = Math.max(0, stamina.value - STAMINA_RUN_DRAIN * effort);
      stamina.value = stam;
      if (stam <= 0) exhausted.value = true;
    } else if (exhausted.value && stamina.value >= RECOVER_THRESHOLD) {
      // Only reachable if something outside this loop topped the bar back up
      exhausted.value = false;
    }

    // Hunger/thirst: only tick down while actually moving. No effect at zero
    // yet — the bars just bottom out.
    if (effort > 0) {
      const upkeep = effort * (running ? RUN_UPKEEP_MULTIPLIER : 1);
      hunger.value = Math.max(0, hunger.value - HUNGER_DRAIN * upkeep);
      thirst.value = Math.max(0, thirst.value - THIRST_DRAIN * upkeep);
    }

    const speed = PLAYER_SPEED * (exhausted.value ? EXHAUSTED_SPEED : 1);
    const px = playerX.value;
    const py = playerY.value;

    let nx = Math.max(
      playerRadius,
      Math.min(worldWidth - playerRadius, px + dirX.value * speed)
    );
    let ny = Math.max(
      playerRadius,
      Math.min(worldHeight - playerRadius, py + dirY.value * speed)
    );

    // Resolve each axis on its own, so walking diagonally into a wall slides
    // along it instead of stopping dead.
    for (let i = 0; i < obstacles.length; i++) {
      if (hitsObstacle(nx, py, playerRadius, obstacles[i])) {
        nx = px;
        break;
      }
    }
    for (let i = 0; i < obstacles.length; i++) {
      if (hitsObstacle(nx, ny, playerRadius, obstacles[i])) {
        ny = py;
        break;
      }
    }

    playerX.value = nx;
    playerY.value = ny;
  });

  // Manual gesture — tracks whichever finger touched the left half
  const moveGesture = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((e, mgr) => {
          "worklet";
          if (movePointerID.value !== -1) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.absoluteX < halfWidth) {
              movePointerID.value = t.id;
              moveStartX.value = t.absoluteX;
              moveStartY.value = t.absoluteY;
              mgr.activate();
              return;
            }
          }
        })
        .onTouchesMove((e) => {
          "worklet";
          const pid = movePointerID.value;
          if (pid === -1) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.id !== pid) continue;
            const dx = t.absoluteX - moveStartX.value;
            const dy = t.absoluteY - moveStartY.value;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);
            const angle = Math.atan2(dy, dx);
            const ratio = clamped / JOYSTICK_BASE_RADIUS;
            moveKnobOffX.value = Math.cos(angle) * clamped;
            moveKnobOffY.value = Math.sin(angle) * clamped;
            dirX.value = Math.cos(angle) * ratio;
            dirY.value = Math.sin(angle) * ratio;
            break;
          }
        })
        .onTouchesUp((e, mgr) => {
          "worklet";
          const pid = movePointerID.value;
          if (pid === -1) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].id !== pid) continue;
            movePointerID.value = -1;
            moveKnobOffX.value = withSpring(0, { damping: 15 });
            moveKnobOffY.value = withSpring(0, { damping: 15 });
            dirX.value = 0;
            dirY.value = 0;
            mgr.end();
            break;
          }
        }),
    []
  ); // stable: shared value refs don't change, halfWidth is constant

  const moveKnobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: moveKnobOffX.value },
      { translateY: moveKnobOffY.value },
    ],
  }));

  return {
    playerX,
    playerY,
    stamina,
    hunger,
    thirst,
    temperature,
    exhausted,
    moveGesture,
    moveKnobStyle,
  };
}

// ---------------------------------------------------------------------------
// Joystick — pure visual overlay, no gesture handling
// ---------------------------------------------------------------------------

interface JoystickProps {
  // Not `ReturnType<typeof useAnimatedStyle>` — with the generic unresolved that
  // widens to ViewStyle & ImageStyle & TextStyle, whose loose `cursor: string`
  // is rejected by Animated.View's style prop.
  knobStyle: AnimatedStyle<ViewStyle>;
}

export function Joystick({ knobStyle }: JoystickProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.base}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "flex-start",
    paddingBottom: 48,
    paddingLeft: 32,
  },
  base: {
    width: JOYSTICK_BASE_RADIUS * 2,
    height: JOYSTICK_BASE_RADIUS * 2,
    borderRadius: JOYSTICK_BASE_RADIUS,
    backgroundColor: "rgba(20, 33, 61, 0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(229, 229, 229, 0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: JOYSTICK_KNOB_RADIUS * 2,
    height: JOYSTICK_KNOB_RADIUS * 2,
    borderRadius: JOYSTICK_KNOB_RADIUS,
    backgroundColor: Colors.orange,
    opacity: 0.9,
  },
});
