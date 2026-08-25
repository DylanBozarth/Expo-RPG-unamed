import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import {
  INVENTORY_COLS,
  INVENTORY_SIZE,
  useInventoryStore,
  type InventoryItem,
  type ItemUse,
} from "../../store/inventory-store";
import { Colors } from "../../styling/theme";

const SLOT_SIZE = 54;
const SLOT_GAP = 6;
const GRID_WIDTH = INVENTORY_COLS * SLOT_SIZE + (INVENTORY_COLS - 1) * SLOT_GAP;

/**
 * Travel that separates a tap from a drag. The taps fail past it and the pan
 * activates at it, so the two hand over at the same threshold.
 */
const TAP_SLOP = 12;

const GHOST_SIZE = 54;

// ---------------------------------------------------------------------------
// Drag plumbing — one ghost, owned by the panel, driven by whichever slot holds
// the finger. Per-slot ghosts would be clipped by the panel they live in.
// ---------------------------------------------------------------------------

interface DragApi {
  /** Finger position in screen px. */
  x: SharedValue<number>;
  y: SharedValue<number>;
  begin: (index: number) => void;
  /** Released: drop it in the world, unless it landed back on the panel. */
  end: (index: number, screenX: number, screenY: number) => void;
  cancel: () => void;
}

// ---------------------------------------------------------------------------
// Slot
// ---------------------------------------------------------------------------

interface SlotProps {
  item: InventoryItem | null;
  index: number;
  isSelected: boolean;
  isDragging: boolean;
  onTap: (index: number) => void;
  onDoubleTap: (index: number) => void;
  /** null while there is nowhere to drop things — dragging is then disabled. */
  drag: DragApi | null;
}

function Slot({
  item,
  index,
  isSelected,
  isDragging,
  onTap,
  onDoubleTap,
  drag,
}: SlotProps) {
  // Exclusive() gives the double tap priority, so the single tap only fires
  // once gesture-handler has ruled a second tap out. Hand-rolled tap timing
  // would have to delay every select by the double-tap window instead.
  const gesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(TAP_SLOP)
      .onEnd(() => onDoubleTap(index))
      .runOnJS(true);

    const singleTap = Gesture.Tap()
      .maxDistance(TAP_SLOP)
      .onEnd(() => onTap(index))
      .runOnJS(true);

    if (!drag || !item) return Gesture.Exclusive(doubleTap, singleTap);

    // Last in the Exclusive chain: it can only start once both taps have failed,
    // which they do the moment the finger travels past TAP_SLOP.
    const pan = Gesture.Pan()
      .minDistance(TAP_SLOP)
      .onStart((e) => {
        "worklet";
        drag.x.value = e.absoluteX;
        drag.y.value = e.absoluteY;
        runOnJS(drag.begin)(index);
      })
      .onUpdate((e) => {
        "worklet";
        drag.x.value = e.absoluteX;
        drag.y.value = e.absoluteY;
      })
      .onEnd((e, success) => {
        "worklet";
        if (success) runOnJS(drag.end)(index, e.absoluteX, e.absoluteY);
      })
      // Cancelled drags (a second finger, a screen change) still have to put
      // the ghost away
      .onFinalize(() => {
        "worklet";
        runOnJS(drag.cancel)();
      });

    return Gesture.Exclusive(doubleTap, singleTap, pan);
  }, [index, item, onTap, onDoubleTap, drag]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.slot, isSelected && styles.slotSelected]}>
        {item && (
          <View style={[styles.itemWrap, isDragging && styles.dragged]}>
            <View style={[styles.itemChip, { backgroundColor: item.color }]}>
              <Text style={styles.itemShort}>{item.short}</Text>
            </View>
            {item.qty > 1 && <Text style={styles.qty}>{item.qty}</Text>}
            {/* Affordance for "this one does something when double-tapped" */}
            {item.use && <View style={styles.usableMark} />}
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

// ---------------------------------------------------------------------------
// Inventory — toggle button plus the grid panel
// ---------------------------------------------------------------------------

interface InventoryProps {
  /** Applies a consumed item's effect — the vitals live outside the store. */
  onConsume: (use: ItemUse) => void;
  /**
   * Called when a stack is dragged off the panel, with the release point in
   * screen px. Omit it on screens with no world to drop things into.
   */
  onDrop?: (item: InventoryItem, screenX: number, screenY: number) => void;
}

export function Inventory({ onConsume, onDrop }: InventoryProps) {
  const isOpen = useInventoryStore((s) => s.isOpen);
  const slots = useInventoryStore((s) => s.slots);
  const selected = useInventoryStore((s) => s.selected);
  const toggle = useInventoryStore((s) => s.toggle);
  const tapSlot = useInventoryStore((s) => s.tapSlot);
  const consumeItem = useInventoryStore((s) => s.consumeItem);
  const dropSlot = useInventoryStore((s) => s.dropSlot);

  const handleDoubleTap = useCallback(
    (index: number) => {
      const use = consumeItem(index);
      if (use) onConsume(use);
    },
    [consumeItem, onConsume]
  );

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Where the panel sits on screen, so a drag released over it counts as
  // putting the item back rather than dropping it. Measured instead of derived
  // from the styles, which say nothing about the panel's height.
  const panelRef = useRef<View>(null);
  const panelFrame = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const measurePanel = useCallback(() => {
    panelRef.current?.measureInWindow((x, y, width, height) => {
      panelFrame.current = { x, y, width, height };
    });
  }, []);

  const handleDragEnd = useCallback(
    (index: number, screenX: number, screenY: number) => {
      setDragIndex(null);
      if (!onDrop) return;

      const panel = panelFrame.current;
      const overPanel =
        screenX >= panel.x &&
        screenX <= panel.x + panel.width &&
        screenY >= panel.y &&
        screenY <= panel.y + panel.height;
      if (overPanel) return;

      const item = dropSlot(index);
      if (item) onDrop(item, screenX, screenY);
    },
    [dropSlot, onDrop]
  );

  const drag = useMemo<DragApi | null>(
    () =>
      onDrop
        ? {
            x: dragX,
            y: dragY,
            begin: setDragIndex,
            end: handleDragEnd,
            cancel: () => setDragIndex(null),
          }
        : null,
    [onDrop, dragX, dragY, handleDragEnd]
  );

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value - GHOST_SIZE / 2 },
      { translateY: dragY.value - GHOST_SIZE / 2 },
    ],
  }));

  const dragItem = dragIndex === null ? null : slots[dragIndex];
  const used = slots.filter(Boolean).length;

  return (
    <>
      <Pressable style={styles.toggle} onPress={toggle}>
        <Text style={styles.toggleText}>{isOpen ? "CLOSE" : "BAG"}</Text>
      </Pressable>

      {isOpen && (
        <View ref={panelRef} onLayout={measurePanel} style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>INVENTORY</Text>
            <Text style={styles.count}>
              {used}/{INVENTORY_SIZE}
            </Text>
          </View>

          <View style={styles.grid}>
            {slots.map((item, i) => (
              <Slot
                key={i}
                item={item}
                index={i}
                isSelected={selected === i}
                isDragging={dragIndex === i}
                onTap={tapSlot}
                onDoubleTap={handleDoubleTap}
                drag={drag}
              />
            ))}
          </View>

          <Text style={styles.hint}>
            {selected === null
              ? "Tap to pick up · double-tap to use\ndrag out of the bag to drop"
              : "Tap a slot to move it there"}
          </Text>
        </View>
      )}

      {/* Outside the panel so it isn't clipped, and last so it draws on top */}
      {dragItem && (
        <Animated.View
          style={[styles.ghost, ghostStyle]}
          pointerEvents="none"
        >
          <View style={[styles.itemChip, { backgroundColor: dragItem.color }]}>
            <Text style={styles.itemShort}>{dragItem.short}</Text>
          </View>
          <Text style={styles.ghostName} numberOfLines={1}>
            {dragItem.qty > 1
              ? `${dragItem.name} x${dragItem.qty}`
              : dragItem.name}
          </Text>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: {
    position: "absolute",
    top: 40,
    right: 40,
    backgroundColor: "rgba(20, 33, 61, 0.85)",
    borderWidth: 1.5,
    borderColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  toggleText: {
    color: Colors.orange,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  panel: {
    position: "absolute",
    top: 90,
    right: 20,
    padding: 14,
    backgroundColor: "rgba(5, 5, 8, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.2)",
    borderRadius: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    color: Colors.alabaster,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  count: {
    color: "rgba(229, 229, 229, 0.5)",
    fontSize: 11,
    fontWeight: "600",
  },
  grid: {
    width: GRID_WIDTH,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SLOT_GAP,
  },
  slot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: 6,
    backgroundColor: "rgba(20, 33, 61, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  slotSelected: {
    borderColor: Colors.orange,
    borderWidth: 2,
    backgroundColor: "rgba(252, 163, 17, 0.18)",
  },
  // Fills the slot so the badges below keep the offsets they were written for
  itemWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  dragged: {
    opacity: 0.3,
  },
  itemChip: {
    width: 34,
    height: 34,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  itemShort: {
    color: Colors.black,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  qty: {
    position: "absolute",
    bottom: 2,
    right: 4,
    color: Colors.white,
    fontSize: 10,
    fontWeight: "700",
  },
  usableMark: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.white,
    opacity: 0.7,
  },
  hint: {
    color: "rgba(229, 229, 229, 0.45)",
    fontSize: 10,
    textAlign: "center",
  },
  ghost: {
    position: "absolute",
    left: 0,
    top: 0,
    width: GHOST_SIZE,
    alignItems: "center",
    gap: 3,
  },
  ghostName: {
    color: Colors.orange,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
