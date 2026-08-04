import { Canvas, Circle, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AimArrow, Joystick, useMovement } from '../../components/movement/movement';
import { WeaponBar } from '../../components/weapon-bar/weapon-bar';
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

// 16 cols × 24 rows — exported for pathfinding
export const MAP_GRID: TerrainId[][] = [

    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,3,3,3,3,3,3,3,3,3,3,3,3,3,1],
    [1,3,3,3,3,3,3,3,3,3,3,3,3,3,3,1],
    [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3]

];

const COLS = MAP_GRID[0].length;
const ROWS = MAP_GRID.length;

const PLAYER_RADIUS = 18;
const ENEMY_RADIUS  = 14;
const PROJ_RADIUS   = 6;
const PROJ_SPEED    = 14;
const MAX_PROJ      = 16;

// Struct-of-arrays so worklets can mutate in place then trigger a single assignment
interface ProjPool {
  x:     number[];
  y:     number[];
  vx:    number[];
  vy:    number[];
  alive: boolean[];
}

function makeProjPool(): ProjPool {
  return {
    x:     new Array(MAX_PROJ).fill(0),
    y:     new Array(MAX_PROJ).fill(0),
    vx:    new Array(MAX_PROJ).fill(0),
    vy:    new Array(MAX_PROJ).fill(0),
    alive: new Array(MAX_PROJ).fill(false),
  };
}

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
    fireCount,
    combinedGesture,
    moveKnobStyle, aimKnobStyle,
  } = useMovement(width, height, PLAYER_RADIUS);

  const muzzleFlash  = useSharedValue(0);
  const gameOver     = useSharedValue(false);
  const projPool     = useSharedValue<ProjPool>(makeProjPool());
  const enemyAlive   = useSharedValue<boolean[]>(enemies.map(() => true));

  // ---------------------------------------------------------------------------
  // Game loop — projectile physics + all collision
  // ---------------------------------------------------------------------------
  useFrameCallback(() => {
    'worklet';
    if (gameOver.value) return;

    const pool  = projPool.value;
    const alive = enemyAlive.value;
    let projDirty  = false;
    let enemyDirty = false;

    // Move projectiles + collision vs enemies
    for (let i = 0; i < MAX_PROJ; i++) {
      if (!pool.alive[i]) continue;

      const nx = pool.x[i] + pool.vx[i];
      const ny = pool.y[i] + pool.vy[i];

      // Off-screen — retire
      if (nx < 0 || nx > width || ny < 0 || ny > height) {
        pool.alive[i] = false;
        projDirty = true;
        continue;
      }

      pool.x[i] = nx;
      pool.y[i] = ny;
      projDirty = true;

      // Check vs each live enemy
      for (let j = 0; j < enemies.length; j++) {
        if (!alive[j]) continue;
        const dx = nx - enemies[j].x;
        const dy = ny - enemies[j].y;
        if (dx * dx + dy * dy < (PROJ_RADIUS + ENEMY_RADIUS) ** 2) {
          pool.alive[i] = false;
          alive[j]      = false;
          enemyDirty    = true;
          break;
        }
      }
    }

    if (projDirty)  projPool.value   = { ...pool };
    if (enemyDirty) enemyAlive.value = [...alive];

    // Player vs live enemy — game over
    for (let i = 0; i < enemies.length; i++) {
      if (!alive[i]) continue;
      const dx = playerX.value - enemies[i].x;
      const dy = playerY.value - enemies[i].y;
      if (dx * dx + dy * dy < (PLAYER_RADIUS + ENEMY_RADIUS) ** 2) {
        gameOver.value = true;
        return;
      }
    }
  });

  // Bridge game-over to JS thread
  useAnimatedReaction(
    () => gameOver.value,
    (hit) => { if (hit) runOnJS(onGameOver)(); },
  );

  // Spawn projectile + muzzle flash on each fire tap
  useAnimatedReaction(
    () => fireCount.value,
    (count, prev) => {
      if (count === prev || gameOver.value) return;

      muzzleFlash.value = 1;
      muzzleFlash.value = withTiming(0, { duration: 120 });

      const pool = projPool.value;
      for (let i = 0; i < MAX_PROJ; i++) {
        if (pool.alive[i]) continue;
        const angle   = aimAngle.value;
        pool.x[i]     = playerX.value;
        pool.y[i]     = playerY.value;
        pool.vx[i]    = Math.cos(angle) * PROJ_SPEED;
        pool.vy[i]    = Math.sin(angle) * PROJ_SPEED;
        pool.alive[i] = true;
        projPool.value = { ...pool };
        break;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Reactive Skia paths — built on UI thread, read by Canvas directly
  // ---------------------------------------------------------------------------
  const enemyPath = useDerivedValue(() => {
    const path  = Skia.Path.Make();
    const alive = enemyAlive.value;
    for (let i = 0; i < enemies.length; i++) {
      if (alive[i]) path.addCircle(enemies[i].x, enemies[i].y, ENEMY_RADIUS);
    }
    return path;
  });

  const projPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const pool = projPool.value;
    for (let i = 0; i < MAX_PROJ; i++) {
      if (pool.alive[i]) path.addCircle(pool.x[i], pool.y[i], PROJ_RADIUS);
    }
    return path;
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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

        <Path path={enemyPath} color="#e63946" />
        <Path path={projPath}  color="#4cc9f0" />

        <AimArrow
          playerX={playerX}
          playerY={playerY}
          aimAngle={aimAngle}
          playerRadius={PLAYER_RADIUS}
          muzzleFlash={muzzleFlash}
        />
        <Circle cx={playerX} cy={playerY} r={PLAYER_RADIUS} color={Colors.orange} />
      </Canvas>

      <GestureDetector gesture={combinedGesture}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-only">
          <Joystick side="left"  knobStyle={moveKnobStyle} />
          <Joystick side="right" knobStyle={aimKnobStyle}  />
        </View>
      </GestureDetector>

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
