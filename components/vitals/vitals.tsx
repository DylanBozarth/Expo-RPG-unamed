import {
  Canvas,
  LinearGradient,
  Rect,
  RoundedRect,
  vec,
} from "@shopify/react-native-skia";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { Colors } from "../../styling/theme";

// ---------------------------------------------------------------------------
// Tuning — all rates are per frame at 60fps
// ---------------------------------------------------------------------------

export const MAX_VITAL = 100;

/**
 * Joystick magnitude above this counts as running. Below it the player is
 * walking, which costs no stamina — the stick's own magnitude already scales
 * velocity, so a light push is a slow, sustainable walk.
 */
export const RUN_THRESHOLD = 0.55;

/**
 * Only running spends stamina, and it never comes back on its own — resting
 * does not refill the bar. ~83s of continuous sprinting empties it, which is
 * roughly four world-widths of running per expedition.
 */
export const STAMINA_RUN_DRAIN = 0.02;

/** Speed multiplier while exhausted — a stagger, not a full stop. */
export const EXHAUSTED_SPEED = 0.45;

/**
 * Stamina must climb back to this before running unlocks again (hysteresis).
 * Nothing raises stamina today, so this only fires once something external
 * tops the bar up — a consumable, a rest point, a vehicle.
 */
export const RECOVER_THRESHOLD = 25;

/** Hunger empties after ~8 minutes of movement, thirst after ~5. */
export const HUNGER_DRAIN = 0.0035;
export const THIRST_DRAIN = 0.0055;

/** Running burns food and water faster than walking. */
export const RUN_UPKEEP_MULTIPLIER = 1.6;

// ---------------------------------------------------------------------------
// Temperature — bipolar, unlike the other three
// ---------------------------------------------------------------------------

/** Freezing at TEMP_MIN, overheating at TEMP_MAX, comfortable at 0. */
export const TEMP_MIN = -100;
export const TEMP_MAX = 100;

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const BAR_WIDTH = 132;
const BAR_HEIGHT = 8;

const TEMP_CANVAS_HEIGHT = 14;
const TEMP_THUMB_WIDTH = 4;
const TEMP_TRACK_Y = (TEMP_CANVAS_HEIGHT - BAR_HEIGHT) / 2;

const COLD_COLOR = "#4cc9f0";
const NEUTRAL_COLOR = "rgba(229, 229, 229, 0.22)";
const HOT_COLOR = "#e63946";

interface VitalBarProps {
  label: string;
  value: SharedValue<number>;
  color: string;
}

function VitalBar({ label, value, color }: VitalBarProps) {
  // scaleX from the left edge rather than an animated `width` — keeps the bar
  // off the layout pass entirely, so it costs nothing to update every frame.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0, Math.min(1, value.value / MAX_VITAL)) }],
  }));

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <Animated.View
          style={[styles.fill, { backgroundColor: color }, fillStyle]}
        />
      </View>
    </View>
  );
}

/**
 * Bipolar gauge: blue at the cold end, clear through the middle, red at the
 * hot end, with a sliding indicator marking the current reading — closer to a
 * phone's volume slider than to a fill bar.
 */
function TemperatureBar({ value }: { value: SharedValue<number> }) {
  const thumbX = useDerivedValue(() => {
    const t = (value.value - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    return Math.max(0, Math.min(1, t)) * (BAR_WIDTH - TEMP_THUMB_WIDTH);
  });

  return (
    <View style={styles.row}>
      <Text style={styles.label}>TEMP</Text>
      <Canvas style={{ width: BAR_WIDTH, height: TEMP_CANVAS_HEIGHT }}>
        <RoundedRect
          x={0}
          y={TEMP_TRACK_Y}
          width={BAR_WIDTH}
          height={BAR_HEIGHT}
          r={BAR_HEIGHT / 2}
        >
          <LinearGradient
            start={vec(0, 0)}
            end={vec(BAR_WIDTH, 0)}
            colors={[COLD_COLOR, NEUTRAL_COLOR, HOT_COLOR]}
            positions={[0, 0.5, 1]}
          />
        </RoundedRect>

        {/* Outline, so the clear middle still reads as part of the track */}
        <RoundedRect
          x={0.5}
          y={TEMP_TRACK_Y + 0.5}
          width={BAR_WIDTH - 1}
          height={BAR_HEIGHT - 1}
          r={BAR_HEIGHT / 2}
          color="rgba(229, 229, 229, 0.25)"
          style="stroke"
          strokeWidth={1}
        />

        {/* Neutral notch at dead centre */}
        <Rect
          x={BAR_WIDTH / 2 - 0.5}
          y={TEMP_TRACK_Y}
          width={1}
          height={BAR_HEIGHT}
          color="rgba(229, 229, 229, 0.45)"
        />

        <RoundedRect
          x={thumbX}
          y={0}
          width={TEMP_THUMB_WIDTH}
          height={TEMP_CANVAS_HEIGHT}
          r={2}
          color={Colors.white}
        />
      </Canvas>
    </View>
  );
}

interface VitalsHudProps {
  stamina: SharedValue<number>;
  hunger: SharedValue<number>;
  thirst: SharedValue<number>;
  temperature: SharedValue<number>;
}

export function VitalsHud({
  stamina,
  hunger,
  thirst,
  temperature,
}: VitalsHudProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      <VitalBar label="Stamina" value={stamina} color={Colors.orange} />
      <VitalBar label="Hunger" value={hunger} color="#8bc34a" />
      <VitalBar label="Thirst" value={thirst} color={COLD_COLOR} />
      <TemperatureBar value={temperature} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 44,
    left: 25,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    width: 45,
    color: Colors.alabaster,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  track: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: "rgba(5, 5, 8, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.25)",
    overflow: "hidden",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 3,
    transformOrigin: "left",
  },
});
