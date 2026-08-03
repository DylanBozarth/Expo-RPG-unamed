import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Circle, Rect } from '@shopify/react-native-skia';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
  withSpring,
} from 'react-native-reanimated';
import { Colors } from '../../styling/theme';

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const T = {
  VOID:   0,
  GROUND: 1,
  ROCK:   2,
  CRATER: 3,
  LIQUID: 4,
  LAVA:   5,
  FLORA:  6,
} as const;

export type TerrainId = typeof T[keyof typeof T];

export const TERRAIN_COLORS: Record<TerrainId, string> = {
  [T.VOID]:   '#050508',
  [T.GROUND]: '#7a5c3e',
  [T.ROCK]:   '#3d3d4d',
  [T.CRATER]: '#2e1a10',
  [T.LIQUID]: '#0d3d5c',
  [T.LAVA]:   '#fca311',
  [T.FLORA]:  '#1a6b45',
};

// 16 cols × 24 rows
export const MAP_GRID: TerrainId[][] = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,4,4,4,4,4,4,4,4,4,4,4,4,4,4,0],
  [0,4,1,1,1,1,5,5,5,1,1,1,1,1,4,0],
  [0,4,1,2,2,1,1,5,1,1,1,2,2,1,4,0],
  [0,4,1,2,1,1,1,1,1,1,1,1,2,1,4,0],
  [0,4,1,1,1,6,6,1,1,6,6,1,1,1,4,0],
  [0,4,1,1,1,6,1,1,1,1,6,1,1,1,4,0],
  [0,4,2,2,1,1,1,3,3,1,1,1,2,2,4,0],
  [0,4,1,1,1,1,3,3,3,3,1,1,1,1,4,0],
  [0,4,1,1,1,1,1,1,1,1,1,1,1,1,4,0],
  [0,4,1,1,5,5,1,1,1,1,5,5,1,1,4,0],
  [0,4,1,1,5,1,1,1,1,1,1,5,1,1,4,0],
  [0,4,1,1,1,1,2,1,1,2,1,1,1,1,4,0],
  [0,4,1,3,1,2,2,1,1,2,2,1,3,1,4,0],
  [0,4,1,3,1,1,1,1,1,1,1,1,3,1,4,0],
  [0,4,1,1,1,6,1,1,1,1,6,1,1,1,4,0],
  [0,4,1,1,1,6,6,1,1,6,6,1,1,1,4,0],
  [0,4,2,1,1,1,1,1,1,1,1,1,1,2,4,0],
  [0,4,2,2,1,1,1,1,1,1,1,1,2,2,4,0],
  [0,4,1,1,1,1,1,3,3,1,1,1,1,1,4,0],
  [0,4,1,1,1,1,3,3,3,3,1,1,1,1,4,0],
  [0,4,1,1,1,1,1,1,1,1,1,1,1,1,4,0],
  [0,4,4,4,4,4,4,4,4,4,4,4,4,4,4,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const COLS = MAP_GRID[0].length;
const ROWS = MAP_GRID.length;

// ---------------------------------------------------------------------------
// Player + joystick constants
// ---------------------------------------------------------------------------

const PLAYER_RADIUS = 18;
const PLAYER_SPEED  = 4;

const JOYSTICK_BASE_RADIUS = 52;
const JOYSTICK_KNOB_RADIUS = 22;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const { width, height } = useWindowDimensions();

  const cellW = width  / COLS;
  const cellH = height / ROWS;

  // Player position — Reanimated SharedValues so Skia reads them on the UI thread
  const playerX = useSharedValue(width  / 2);
  const playerY = useSharedValue(height / 2);

  // Joystick direction vector (-1 to 1 on each axis)
  const dirX = useSharedValue(0);
  const dirY = useSharedValue(0);

  // Joystick knob visual offset
  const knobOffX = useSharedValue(0);
  const knobOffY = useSharedValue(0);

  // Game loop — runs every frame on the UI thread
  useFrameCallback(() => {
    'worklet';
    const nx = playerX.value + dirX.value * PLAYER_SPEED;
    const ny = playerY.value + dirY.value * PLAYER_SPEED;
    playerX.value = Math.max(PLAYER_RADIUS, Math.min(width  - PLAYER_RADIUS, nx));
    playerY.value = Math.max(PLAYER_RADIUS, Math.min(height - PLAYER_RADIUS, ny));
  });

  // Joystick pan gesture — runs on UI thread (accesses SharedValues directly)
  const joystickGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      const dist    = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
      const clamped = Math.min(dist, JOYSTICK_BASE_RADIUS);
      const angle   = Math.atan2(e.translationY, e.translationX);
      const ratio   = clamped / JOYSTICK_BASE_RADIUS;

      knobOffX.value = Math.cos(angle) * clamped;
      knobOffY.value = Math.sin(angle) * clamped;

      dirX.value = Math.cos(angle) * ratio;
      dirY.value = Math.sin(angle) * ratio;
    })
    .onEnd(() => {
      'worklet';
      knobOffX.value = withSpring(0, { damping: 15 });
      knobOffY.value = withSpring(0, { damping: 15 });
      dirX.value = 0;
      dirY.value = 0;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: knobOffX.value },
      { translateY: knobOffY.value },
    ],
  }));

  return (
    <View style={styles.container}>
      {/* Game canvas */}
      <Canvas style={{ width, height }}>
        {MAP_GRID.map((row, rowIdx) =>
          row.map((cell, colIdx) => (
            <Rect
              key={`${rowIdx}-${colIdx}`}
              x={colIdx * cellW}
              y={rowIdx * cellH}
              width={cellW}
              height={cellH}
              color={TERRAIN_COLORS[cell]}
            />
          ))
        )}
        {/* Player */}
        <Circle cx={playerX} cy={playerY} r={PLAYER_RADIUS} color={Colors.orange} />
      </Canvas>

      {/* HUD — touch events only hit the joystick, rest pass through */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
        <View style={styles.joystickContainer} pointerEvents="box-none">
          <GestureDetector gesture={joystickGesture}>
            <View style={styles.joystickBase}>
              <Animated.View style={[styles.joystickKnob, knobStyle]} />
            </View>
          </GestureDetector>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
  },
  joystickContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems:     'flex-start',
    paddingLeft:    32,
    paddingBottom:  48,
  },
  joystickBase: {
    width:           JOYSTICK_BASE_RADIUS * 2,
    height:          JOYSTICK_BASE_RADIUS * 2,
    borderRadius:    JOYSTICK_BASE_RADIUS,
    backgroundColor: 'rgba(20, 33, 61, 0.55)',
    borderWidth:     1.5,
    borderColor:     'rgba(229, 229, 229, 0.25)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  joystickKnob: {
    width:        JOYSTICK_KNOB_RADIUS * 2,
    height:       JOYSTICK_KNOB_RADIUS * 2,
    borderRadius: JOYSTICK_KNOB_RADIUS,
    backgroundColor: Colors.orange,
    opacity:      0.9,
  },
});
