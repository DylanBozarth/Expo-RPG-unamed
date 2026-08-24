import { matchFont, Rect, Text as SkiaText } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import { TILE } from "../map/terrain";
import { Colors } from "../../styling/theme";

/** A doorway in world px. */
export interface DoorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How close the player must be before the door lights up and accepts a tap. */
export const DOOR_REACH = TILE * 1.4;

/** Doors are small targets, so taps get a forgiving margin around them. */
const DOOR_TAP_PADDING = 24;

const PROMPT = "TAP TO ENTER";
const promptFont = matchFont({ fontSize: 12, fontWeight: "700" });

/** Squared distance from a point to the nearest point on the door. */
function distanceSqToDoor(px: number, py: number, door: DoorRect): number {
  "worklet";
  const nx = Math.max(door.x, Math.min(px, door.x + door.width));
  const ny = Math.max(door.y, Math.min(py, door.y + door.height));
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy;
}

/**
 * True while the player is within reach of the door. The distance test runs on
 * the UI thread every frame and only crosses to JS on a transition.
 */
export function useDoorProximity(
  playerX: SharedValue<number>,
  playerY: SharedValue<number>,
  door: DoorRect
): boolean {
  const [near, setNear] = useState(false);

  useAnimatedReaction(
    () =>
      distanceSqToDoor(playerX.value, playerY.value, door) <
      DOOR_REACH * DOOR_REACH,
    (isNear, prev) => {
      if (isNear !== prev) runOnJS(setNear)(isNear);
    }
  );

  return near;
}

/** Whether a world-space point landed on the door, with the tap margin. */
export function isTapOnDoor(
  worldX: number,
  worldY: number,
  door: DoorRect
): boolean {
  return (
    worldX >= door.x - DOOR_TAP_PADDING &&
    worldX <= door.x + door.width + DOOR_TAP_PADDING &&
    worldY >= door.y - DOOR_TAP_PADDING &&
    worldY <= door.y + door.height + DOOR_TAP_PADDING
  );
}

interface DoorProps {
  door: DoorRect;
  /** Within reach — highlight and show the prompt. */
  active: boolean;
  /**
   * Which side the prompt sits on. Put it where the player stands: below an
   * exterior door, above an interior one.
   */
  promptSide?: "above" | "below";
}

export function Door({ door, active, promptSide = "below" }: DoorProps) {
  const prompt = useMemo(() => {
    const metrics = promptFont.measureText(PROMPT);
    return {
      x: door.x + door.width / 2 - metrics.width / 2,
      y:
        promptSide === "below"
          ? door.y + door.height + metrics.height + 14
          : door.y - 14,
    };
  }, [door, promptSide]);

  return (
    <>
      <Rect
        x={door.x}
        y={door.y}
        width={door.width}
        height={door.height}
        color={active ? Colors.orange : "#2e1a10"}
      />

      {active && (
        <>
          <Rect
            x={door.x}
            y={door.y}
            width={door.width}
            height={door.height}
            color={Colors.white}
            style="stroke"
            strokeWidth={2}
          />
          <SkiaText
            x={prompt.x}
            y={prompt.y}
            text={PROMPT}
            font={promptFont}
            color={Colors.orange}
          />
        </>
      )}
    </>
  );
}
