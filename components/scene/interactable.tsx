import { matchFont, Rect, Text as SkiaText } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import { TILE } from "../map/terrain";
import { Colors } from "../../styling/theme";

/** An interactive thing in the world, in world px. */
export interface InteractRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How close the player must be before it lights up and accepts a tap. */
export const INTERACT_REACH = TILE * 1.4;

/** These are small targets, so taps get a forgiving margin around them. */
const TAP_PADDING = 24;

export const promptFont = matchFont({ fontSize: 12, fontWeight: "700" });

/** Squared distance from a point to the nearest point on the rect. */
function distanceSqTo(px: number, py: number, rect: InteractRect): number {
  "worklet";
  const nx = Math.max(rect.x, Math.min(px, rect.x + rect.width));
  const ny = Math.max(rect.y, Math.min(py, rect.y + rect.height));
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy;
}

/**
 * True while the player is within reach. The distance test runs on the UI
 * thread every frame and only crosses to JS on a transition.
 */
export function useNearby(
  playerX: SharedValue<number>,
  playerY: SharedValue<number>,
  rect: InteractRect
): boolean {
  const [near, setNear] = useState(false);

  useAnimatedReaction(
    () =>
      distanceSqTo(playerX.value, playerY.value, rect) <
      INTERACT_REACH * INTERACT_REACH,
    (isNear, prev) => {
      if (isNear !== prev) runOnJS(setNear)(isNear);
    }
  );

  return near;
}

/** Whether a world-space point landed on the rect, with the tap margin. */
export function isTapOn(
  worldX: number,
  worldY: number,
  rect: InteractRect
): boolean {
  return (
    worldX >= rect.x - TAP_PADDING &&
    worldX <= rect.x + rect.width + TAP_PADDING &&
    worldY >= rect.y - TAP_PADDING &&
    worldY <= rect.y + rect.height + TAP_PADDING
  );
}

interface InteractableProps {
  rect: InteractRect;
  /** Within reach — highlight and show the prompt. */
  active: boolean;
  prompt?: string;
  /** Fill when out of reach. */
  color?: string;
  /**
   * Which side the prompt sits on. Put it where the player stands: below an
   * exterior door, above an interior one.
   */
  promptSide?: "above" | "below";
}

/**
 * A tappable world object: a plain rect that highlights and prints a prompt
 * once the player is close enough to use it.
 */
export function Interactable({
  rect,
  active,
  prompt = "TAP TO ENTER",
  color = "#2e1a10",
  promptSide = "below",
}: InteractableProps) {
  const label = useMemo(() => {
    const metrics = promptFont.measureText(prompt);
    return {
      x: rect.x + rect.width / 2 - metrics.width / 2,
      y:
        promptSide === "below"
          ? rect.y + rect.height + metrics.height + 14
          : rect.y - 14,
    };
  }, [rect, prompt, promptSide]);

  return (
    <>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        color={active ? Colors.orange : color}
      />

      {active && (
        <>
          <Rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            color={Colors.white}
            style="stroke"
            strokeWidth={2}
          />
          <SkiaText
            x={label.x}
            y={label.y}
            text={prompt}
            font={promptFont}
            color={Colors.orange}
          />
        </>
      )}
    </>
  );
}
