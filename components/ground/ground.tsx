import {
  matchFont,
  Oval,
  RoundedRect,
  Text as SkiaText,
} from "@shopify/react-native-skia";
import React, { useMemo, useState } from "react";
import {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import {
  useSceneGroundItems,
  type GroundItem,
  type SceneId,
} from "../../store/ground-store";
import { INTERACT_REACH } from "../scene/interactable";
import { Colors } from "../../styling/theme";

/** Marker box, carrying the item's colour and short glyph like its bag slot. */
const MARKER = 26;
const MARKER_RADIUS = 4;
/** Ring drawn around the marker once the pile is in reach. */
const RING_INSET = 4;

/** Contact shadow, so a marker reads as sitting on the ground. */
const SHADOW_WIDTH = MARKER + 8;
const SHADOW_HEIGHT = 7;
const SHADOW_COLOR = "rgba(0, 0, 0, 0.35)";

const GAP_BELOW_MARKER = 13;

const glyphFont = matchFont({ fontSize: 10, fontWeight: "800" });
const labelFont = matchFont({ fontSize: 12, fontWeight: "700" });

const IDLE_LABEL = "rgba(229, 229, 229, 0.75)";
const MARKER_EDGE = "rgba(5, 5, 8, 0.7)";

/** Placeholder for a sprite: the item's name, and its count if it's a stack. */
function labelFor(item: GroundItem["item"]): string {
  const name = item.name.toUpperCase();
  return item.qty > 1 ? `${name} x${item.qty}` : name;
}

// ---------------------------------------------------------------------------
// Layer — world-space Skia content, so it renders inside SceneCanvas
// ---------------------------------------------------------------------------

interface GroundItemLayerProps {
  scene: SceneId;
  /** The pile within reach, highlighted. */
  nearKey: number | null;
}

export function GroundItemLayer({ scene, nearKey }: GroundItemLayerProps) {
  const items = useSceneGroundItems(scene);

  // measureText is sync, so the geometry only recomputes when the piles change.
  // x/y on a pile is where the finger let go, and the marker centres on it.
  const marks = useMemo(
    () =>
      items.map((g) => {
        const text = labelFor(g.item);
        const label = labelFont.measureText(text);
        const glyph = glyphFont.measureText(g.item.short);
        const left = g.x - MARKER / 2;
        const top = g.y - MARKER / 2;

        return {
          key: g.key,
          color: g.item.color,
          glyph: {
            text: g.item.short,
            // measureText's height is the ink box, so half of it above the
            // centre puts the baseline where the glyph looks centred
            x: g.x - glyph.width / 2,
            y: g.y + glyph.height / 2,
          },
          label: {
            text,
            x: g.x - label.width / 2,
            y: top + MARKER + GAP_BELOW_MARKER + label.height,
          },
          left,
          top,
        };
      }),
    [items]
  );

  return (
    <>
      {marks.map((mark) => {
        const near = mark.key === nearKey;
        return (
          <React.Fragment key={mark.key}>
            <Oval
              x={mark.left + (MARKER - SHADOW_WIDTH) / 2}
              y={mark.top + MARKER - SHADOW_HEIGHT / 2}
              width={SHADOW_WIDTH}
              height={SHADOW_HEIGHT}
              color={SHADOW_COLOR}
            />

            <RoundedRect
              x={mark.left}
              y={mark.top}
              width={MARKER}
              height={MARKER}
              r={MARKER_RADIUS}
              color={mark.color}
            />
            <RoundedRect
              x={mark.left}
              y={mark.top}
              width={MARKER}
              height={MARKER}
              r={MARKER_RADIUS}
              color={MARKER_EDGE}
              style="stroke"
              strokeWidth={1.5}
            />

            <SkiaText
              x={mark.glyph.x}
              y={mark.glyph.y}
              text={mark.glyph.text}
              font={glyphFont}
              color={Colors.black}
            />

            {/* In reach: ring it and light the label up, the same cue the
                other interactables use */}
            {near && (
              <RoundedRect
                x={mark.left - RING_INSET}
                y={mark.top - RING_INSET}
                width={MARKER + RING_INSET * 2}
                height={MARKER + RING_INSET * 2}
                r={MARKER_RADIUS + RING_INSET}
                color={Colors.white}
                style="stroke"
                strokeWidth={2}
              />
            )}

            <SkiaText
              x={mark.label.x}
              y={mark.label.y}
              text={mark.label.text}
              font={labelFont}
              color={near ? Colors.orange : IDLE_LABEL}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reach test
// ---------------------------------------------------------------------------

/**
 * Key of the closest pile within reach, or null. Nearest rather than first, so
 * two piles dropped on top of each other come back up in a predictable order.
 * The distance test runs on the UI thread and only crosses to JS on a change.
 */
export function useNearestGroundItem(
  playerX: SharedValue<number>,
  playerY: SharedValue<number>,
  scene: SceneId
): number | null {
  const items = useSceneGroundItems(scene);
  const [nearKey, setNearKey] = useState<number | null>(null);

  useAnimatedReaction(
    () => {
      let best = -1;
      let bestDistSq = INTERACT_REACH * INTERACT_REACH;
      for (let i = 0; i < items.length; i++) {
        const dx = playerX.value - items[i].x;
        const dy = playerY.value - items[i].y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = items[i].key;
        }
      }
      return best;
    },
    (key, prev) => {
      if (key !== prev) runOnJS(setNearKey)(key === -1 ? null : key);
    },
    [items]
  );

  return nearKey;
}
