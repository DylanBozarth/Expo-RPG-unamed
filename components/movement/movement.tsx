import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    useDerivedValue,
    withSpring,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Skia, Path, Group } from '@shopify/react-native-skia';
import { Colors } from '../../styling/theme';

const PLAYER_SPEED         = 0.5;
const JOYSTICK_BASE_RADIUS = 52;
const JOYSTICK_KNOB_RADIUS = 22;
const ARROW_SHAFT          = 36;
const ARROW_HEAD_SIZE      = 10;
const ARROW_WING_ANGLE     = Math.PI * 0.75;
const AIM_DEAD_ZONE        = 8;

// ---------------------------------------------------------------------------
// Hook — owns all movement + aim state and the game loop
// ---------------------------------------------------------------------------

export function useMovement(width: number, height: number, playerRadius: number) {
  // Player position
  const playerX = useSharedValue(width  / 2);
  const playerY = useSharedValue(height / 2);

  // Movement direction (-1..1 on each axis)
  const dirX = useSharedValue(0);
  const dirY = useSharedValue(0);

  // Aim angle in radians — persists between joystick touches
  const aimAngle = useSharedValue(0);

  // Joystick knob visual offsets
  const moveKnobOffX = useSharedValue(0);
  const moveKnobOffY = useSharedValue(0);
  const aimKnobOffX  = useSharedValue(0);
  const aimKnobOffY  = useSharedValue(0);

  // Game loop — runs every frame on the UI thread
  useFrameCallback(() => {
    'worklet';
    const nx = playerX.value + dirX.value * PLAYER_SPEED;
    const ny = playerY.value + dirY.value * PLAYER_SPEED;
    playerX.value = Math.max(playerRadius, Math.min(width  - playerRadius, nx));
    playerY.value = Math.max(playerRadius, Math.min(height - playerRadius, ny));
  });

  // Left joystick — movement
  const moveGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      const dist    = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
      const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);
      const angle   = Math.atan2(e.translationY, e.translationX);
      const ratio   = clamped / JOYSTICK_BASE_RADIUS;

      moveKnobOffX.value = Math.cos(angle) * clamped;
      moveKnobOffY.value = Math.sin(angle) * clamped;
      dirX.value = Math.cos(angle) * ratio;
      dirY.value = Math.sin(angle) * ratio;
    })
    .onEnd(() => {
      'worklet';
      moveKnobOffX.value = withSpring(0, { damping: 15 });
      moveKnobOffY.value = withSpring(0, { damping: 15 });
      dirX.value = 0;
      dirY.value = 0;
    });

  // Right joystick — aim (angle persists on release)
  const aimGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      const dist = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
      if (dist < AIM_DEAD_ZONE) return;

      const angle   = Math.atan2(e.translationY, e.translationX);
      const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);

      aimKnobOffX.value = Math.cos(angle) * clamped;
      aimKnobOffY.value = Math.sin(angle) * clamped;
      aimAngle.value    = angle;
    })
    .onEnd(() => {
      'worklet';
      aimKnobOffX.value = withSpring(0, { damping: 15 });
      aimKnobOffY.value = withSpring(0, { damping: 15 });
      // aimAngle intentionally kept — gun holds last direction
    });

  const moveKnobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveKnobOffX.value }, { translateY: moveKnobOffY.value }],
  }));

  const aimKnobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: aimKnobOffX.value }, { translateY: aimKnobOffY.value }],
  }));

  return {
    playerX, playerY,
    aimAngle,
    moveGesture, moveKnobStyle,
    aimGesture,  aimKnobStyle,
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
}

export function AimArrow({ playerX, playerY, aimAngle, playerRadius }: AimArrowProps) {
  // Static arrow shape pointing right (0 rad) — computed once on JS thread
  const arrowPath = useMemo(() => {
    const p    = Skia.Path.Make();
    const tipX = playerRadius + ARROW_SHAFT;

    // Shaft
    p.moveTo(playerRadius, 0);
    p.lineTo(tipX, 0);

    // Arrowhead wings
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

  // Transform: translate to player, then rotate by aim angle — runs on UI thread
  const transform = useDerivedValue(() => [
    { translateX: playerX.value },
    { translateY: playerY.value },
    { rotate:     aimAngle.value },
  ]);

  return (
    <Group transform={transform}>
      <Path path={arrowPath} color={Colors.white} strokeWidth={3} style="stroke" />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Joystick — positioned overlay, left or right
// ---------------------------------------------------------------------------

interface JoystickProps {
  gesture:   ReturnType<typeof Gesture.Pan>;
  knobStyle: ReturnType<typeof useAnimatedStyle>;
  side:      'left' | 'right';
}

export function Joystick({ gesture, knobStyle, side }: JoystickProps) {
  return (
    <View
      style={[styles.container, side === 'right' ? styles.right : styles.left]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={gesture}>
        <View style={styles.base}>
          <Animated.View style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
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
