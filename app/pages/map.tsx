import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Circle, Rect } from '@shopify/react-native-skia';
import { Colors } from '../../styling/theme';
import { useMovement, Joystick, AimArrow } from '../../components/movement/movement';

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

// 16 cols × 24 rows — exported for pathfinding
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
  [0,4,1,1,5,1,1,1,1,1,1,1,5,1,1,4,0],
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

const PLAYER_RADIUS = 18;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const { width, height } = useWindowDimensions();

  const cellW = width  / COLS;
  const cellH = height / ROWS;

  const {
    playerX, playerY, aimAngle,
    moveGesture, moveKnobStyle,
    aimGesture,  aimKnobStyle,
  } = useMovement(width, height, PLAYER_RADIUS);

  return (
    <View style={styles.container}>
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
        <AimArrow playerX={playerX} playerY={playerY} aimAngle={aimAngle} playerRadius={PLAYER_RADIUS} />
        <Circle cx={playerX} cy={playerY} r={PLAYER_RADIUS} color={Colors.orange} />
      </Canvas>

      <Joystick side="left"  gesture={moveGesture} knobStyle={moveKnobStyle} />
      <Joystick side="right" gesture={aimGesture}  knobStyle={aimKnobStyle}  />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
  },
});
