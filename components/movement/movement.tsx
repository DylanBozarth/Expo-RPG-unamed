import { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    useDerivedValue,
    withSpring,
    interpolateColor,
} from 'react-native-reanimated';
import type { AnimatedStyle, SharedValue } from 'react-native-reanimated';
import { Skia, Path, Group } from '@shopify/react-native-skia';
import { Colors } from '../../styling/theme';

const PLAYER_SPEED         = 3.2;
const JOYSTICK_BASE_RADIUS = 52;
const JOYSTICK_KNOB_RADIUS = 22;
const ARROW_SHAFT          = 36;
const ARROW_HEAD_SIZE      = 10;
const ARROW_WING_ANGLE     = Math.PI * 0.75;
const AIM_DEAD_ZONE        = 8;
const FIRE_TAP_THRESHOLD   = 12; // px — less movement than this on release = tap-to-fire

// ---------------------------------------------------------------------------
// Hook — owns all movement + aim state and the game loop
// ---------------------------------------------------------------------------

export interface MovementOptions {
  /** Viewport width — only used to split the screen between the two joysticks. */
  screenWidth:  number;
  /** Playfield bounds in world px — the player is clamped to these. */
  worldWidth:   number;
  worldHeight:  number;
  playerRadius: number;
  /** Starting position in world px. */
  startX:       number;
  startY:       number;
}

export function useMovement({
  screenWidth,
  worldWidth,
  worldHeight,
  playerRadius,
  startX,
  startY,
}: MovementOptions) {
  const playerX = useSharedValue(startX);
  const playerY = useSharedValue(startY);
  const dirX    = useSharedValue(0);
  const dirY    = useSharedValue(0);
  const aimAngle = useSharedValue(0);

  const moveKnobOffX = useSharedValue(0);
  const moveKnobOffY = useSharedValue(0);
  const aimKnobOffX  = useSharedValue(0);
  const aimKnobOffY  = useSharedValue(0);

  // Per-pointer tracking — each joystick owns one finger
  const movePointerID = useSharedValue(-1);
  const moveStartX    = useSharedValue(0);
  const moveStartY    = useSharedValue(0);
  const aimPointerID  = useSharedValue(-1);
  const aimStartX     = useSharedValue(0);
  const aimStartY     = useSharedValue(0);
  const aimTotalMoved = useSharedValue(0);
  // Incremented each time a tap-to-fire is detected; callers react to changes
  const fireCount     = useSharedValue(0);

  const halfWidth = screenWidth / 2;

  // Game loop — runs every frame on the UI thread
  useFrameCallback(() => {
    'worklet';
    const nx = playerX.value + dirX.value * PLAYER_SPEED;
    const ny = playerY.value + dirY.value * PLAYER_SPEED;
    playerX.value = Math.max(playerRadius, Math.min(worldWidth  - playerRadius, nx));
    playerY.value = Math.max(playerRadius, Math.min(worldHeight - playerRadius, ny));
  });

  // Manual gesture for left joystick — tracks whichever finger touched the left half
  const moveGesture = useMemo(() => Gesture.Manual()
    .onTouchesDown((e, mgr) => {
      'worklet';
      if (movePointerID.value !== -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.absoluteX < halfWidth) {
          movePointerID.value = t.id;
          moveStartX.value    = t.absoluteX;
          moveStartY.value    = t.absoluteY;
          mgr.activate();
          return;
        }
      }
    })
    .onTouchesMove((e) => {
      'worklet';
      const pid = movePointerID.value;
      if (pid === -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.id !== pid) continue;
        const dx      = t.absoluteX - moveStartX.value;
        const dy      = t.absoluteY - moveStartY.value;
        const dist    = Math.sqrt(dx * dx + dy * dy);
        const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);
        const angle   = Math.atan2(dy, dx);
        const ratio   = clamped / JOYSTICK_BASE_RADIUS;
        moveKnobOffX.value = Math.cos(angle) * clamped;
        moveKnobOffY.value = Math.sin(angle) * clamped;
        dirX.value = Math.cos(angle) * ratio;
        dirY.value = Math.sin(angle) * ratio;
        break;
      }
    })
    .onTouchesUp((e, mgr) => {
      'worklet';
      const pid = movePointerID.value;
      if (pid === -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].id !== pid) continue;
        movePointerID.value    = -1;
        moveKnobOffX.value     = withSpring(0, { damping: 15 });
        moveKnobOffY.value     = withSpring(0, { damping: 15 });
        dirX.value             = 0;
        dirY.value             = 0;
        mgr.end();
        break;
      }
    }), []); // stable: shared value refs don't change, halfWidth is constant

  // Manual gesture for right joystick
  const aimGesture = useMemo(() => Gesture.Manual()
    .onTouchesDown((e, mgr) => {
      'worklet';
      if (aimPointerID.value !== -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.absoluteX >= halfWidth) {
          aimPointerID.value  = t.id;
          aimStartX.value     = t.absoluteX;
          aimStartY.value     = t.absoluteY;
          aimTotalMoved.value = 0;
          mgr.activate();
          return;
        }
      }
    })
    .onTouchesMove((e) => {
      'worklet';
      const pid = aimPointerID.value;
      if (pid === -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.id !== pid) continue;
        const dx      = t.absoluteX - aimStartX.value;
        const dy      = t.absoluteY - aimStartY.value;
        const dist    = Math.sqrt(dx * dx + dy * dy);
        // Track peak displacement so we can distinguish tap from drag on release
        if (dist > aimTotalMoved.value) aimTotalMoved.value = dist;
        if (dist < AIM_DEAD_ZONE) break;
        const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);
        const angle   = Math.atan2(dy, dx);
        aimKnobOffX.value = Math.cos(angle) * clamped;
        aimKnobOffY.value = Math.sin(angle) * clamped;
        aimAngle.value    = angle;
        break;
      }
    })
    .onTouchesUp((e, mgr) => {
      'worklet';
      const pid = aimPointerID.value;
      if (pid === -1) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].id !== pid) continue;
        // Tap-to-fire: finger barely moved → treat as a shot
        if (aimTotalMoved.value < FIRE_TAP_THRESHOLD) {
          fireCount.value += 1;
        }
        aimPointerID.value  = -1;
        aimTotalMoved.value = 0;
        aimKnobOffX.value   = withSpring(0, { damping: 15 });
        aimKnobOffY.value   = withSpring(0, { damping: 15 });
        // aimAngle intentionally kept — gun holds last direction
        mgr.end();
        break;
      }
    }), []);

  // Single simultaneous gesture — both fingers tracked independently
  const combinedGesture = useMemo(
    () => Gesture.Simultaneous(moveGesture, aimGesture),
    [moveGesture, aimGesture],
  );

  const moveKnobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveKnobOffX.value }, { translateY: moveKnobOffY.value }],
  }));

  const aimKnobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: aimKnobOffX.value }, { translateY: aimKnobOffY.value }],
  }));

  return {
    playerX, playerY,
    aimAngle,
    fireCount,
    combinedGesture,
    moveKnobStyle,
    aimKnobStyle,
  };
}

// ---------------------------------------------------------------------------
// AimArrow — Skia component, must live inside a <Canvas>
// ---------------------------------------------------------------------------

interface AimArrowProps {
  playerX:      SharedValue<number>;
  playerY:      SharedValue<number>;
  aimAngle:     SharedValue<number>;
  playerRadius: number;
  muzzleFlash:  SharedValue<number>;
}

export function AimArrow({ playerX, playerY, aimAngle, playerRadius, muzzleFlash }: AimArrowProps) {
  const arrowPath = useMemo(() => {
    const p    = Skia.Path.Make();
    const tipX = playerRadius + ARROW_SHAFT;

    p.moveTo(playerRadius, 0);
    p.lineTo(tipX, 0);

    p.moveTo(tipX, 0);
    p.lineTo(
      tipX + Math.cos(ARROW_WING_ANGLE) * ARROW_HEAD_SIZE,
      Math.sin(ARROW_WING_ANGLE) * ARROW_HEAD_SIZE,
    );
    p.moveTo(tipX, 0);
    p.lineTo(
      tipX + Math.cos(-ARROW_WING_ANGLE) * ARROW_HEAD_SIZE,
      Math.sin(-ARROW_WING_ANGLE) * ARROW_HEAD_SIZE,
    );

    return p;
  }, [playerRadius]);

  const transform = useDerivedValue(() => [
    { translateX: playerX.value },
    { translateY: playerY.value },
    { rotate:     aimAngle.value },
  ]);

  // Flash from orange → white on fire, then fade back
  const arrowColor = useDerivedValue(() =>
    interpolateColor(muzzleFlash.value, [0, 1], [Colors.white, Colors.orange])
  );

  return (
    <Group transform={transform}>
      <Path path={arrowPath} color={arrowColor} strokeWidth={3} style="stroke" />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Joystick — pure visual overlay, no gesture handling
// ---------------------------------------------------------------------------

interface JoystickProps {
  // Not `ReturnType<typeof useAnimatedStyle>` — with the generic unresolved that
  // widens to ViewStyle & ImageStyle & TextStyle, whose loose `cursor: string`
  // is rejected by Animated.View's style prop.
  knobStyle: AnimatedStyle<ViewStyle>;
  side:      'left' | 'right';
}

export function Joystick({ knobStyle, side }: JoystickProps) {
  return (
    <View
      style={[styles.container, side === 'right' ? styles.right : styles.left]}
      pointerEvents="none"
    >
      <View style={styles.base}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingBottom:  48,
  },
  left: {
    alignItems:  'flex-start',
    paddingLeft: 32,
  },
  right: {
    alignItems:   'flex-end',
    paddingRight: 32,
  },
  base: {
    width:           JOYSTICK_BASE_RADIUS * 2,
    height:          JOYSTICK_BASE_RADIUS * 2,
    borderRadius:    JOYSTICK_BASE_RADIUS,
    backgroundColor: 'rgba(20, 33, 61, 0.55)',
    borderWidth:     1.5,
    borderColor:     'rgba(229, 229, 229, 0.25)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  knob: {
    width:           JOYSTICK_KNOB_RADIUS * 2,
    height:          JOYSTICK_KNOB_RADIUS * 2,
    borderRadius:    JOYSTICK_KNOB_RADIUS,
    backgroundColor: Colors.orange,
    opacity:         0.9,
  },
});
