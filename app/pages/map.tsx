import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Canvas, Circle, Rect } from '@shopify/react-native-skia';
import {
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { Colors } from '../../styling/theme';
import { useMovement, Joystick, AimArrow } from '../../components/movement/movement';
import { WeaponBar } from '../../components/weapon-bar/weapon-bar';

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
const ENEMY_RADIUS  = 14;

// [col, row] grid positions — all on GROUND tiles, clear of spawn area
const ENEMY_CELLS: [number, number][] = [
  [3,  5],
  [9,  3],
  [6,  9],
  [10, 9],
  [3, 18],
  [12, 14],
  [6, 21],
  [10, 21],
];

// ---------------------------------------------------------------------------
// Enemy type
// ---------------------------------------------------------------------------

interface Enemy {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// GameContent — remounted on restart via key prop
// ---------------------------------------------------------------------------

interface GameContentProps {
  width:      number;
  height:     number;
  cellW:      number;
  cellH:      number;
  enemies:    Enemy[];
  onGameOver: () => void;
}

function GameContent({ width, height, cellW, cellH, enemies, onGameOver }: GameContentProps) {
  const {
    playerX, playerY, aimAngle,
    moveGesture, moveKnobStyle,
    aimGesture,  aimKnobStyle,
  } = useMovement(width, height, PLAYER_RADIUS);

  const gameOver = useSharedValue(false);

  // Collision detection — runs every frame on the UI thread
  useFrameCallback(() => {
    'worklet';
    if (gameOver.value) return;
    for (let i = 0; i < enemies.length; i++) {
      const dx = playerX.value - enemies[i].x;
      const dy = playerY.value - enemies[i].y;
      if (dx * dx + dy * dy < (PLAYER_RADIUS + ENEMY_RADIUS) ** 2) {
        gameOver.value = true;
        break;
      }
    }
  });

  // Bridge gameOver from UI thread → JS thread
  useAnimatedReaction(
    () => gameOver.value,
    (hit) => {
      if (hit) runOnJS(onGameOver)();
    },
  );

  return (
    <>
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

        {enemies.map((e, i) => (
          <Circle key={i} cx={e.x} cy={e.y} r={ENEMY_RADIUS} color="#e63946" />
        ))}

        <AimArrow playerX={playerX} playerY={playerY} aimAngle={aimAngle} playerRadius={PLAYER_RADIUS} />
        <Circle cx={playerX} cy={playerY} r={PLAYER_RADIUS} color={Colors.orange} />
      </Canvas>

      <Joystick side="left"  gesture={moveGesture} knobStyle={moveKnobStyle} />
      <Joystick side="right" gesture={aimGesture}  knobStyle={aimKnobStyle}  />
      <WeaponBar />
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
  const [gameKey,    setGameKey]    = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);

  const cellW = width  / COLS;
  const cellH = height / ROWS;

  const enemies: Enemy[] = ENEMY_CELLS.map(([col, row]) => ({
    x: (col + 0.5) * cellW,
    y: (row + 0.5) * cellH,
  }));

  function handleGameOver() {
    setIsGameOver(true);
  }

  function restart() {
    setIsGameOver(false);
    setGameKey((k) => k + 1);
  }

  return (
    <View style={styles.container}>
      <GameContent
        key={gameKey}
        width={width}
        height={height}
        cellW={cellW}
        cellH={cellH}
        enemies={enemies}
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
    backgroundColor: '#050508',
  },
});

const goStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 5, 8, 0.88)',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             32,
  },
  title: {
    color:       '#e63946',
    fontSize:    52,
    fontWeight:  '900',
    letterSpacing: 6,
  },
  button: {
    backgroundColor: Colors.orange,
    paddingVertical:   14,
    paddingHorizontal: 48,
    borderRadius:      10,
  },
  buttonText: {
    color:      Colors.white,
    fontSize:   18,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
