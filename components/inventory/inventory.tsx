import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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

// ---------------------------------------------------------------------------
// Slot
// ---------------------------------------------------------------------------

interface SlotProps {
  item: InventoryItem | null;
  index: number;
  isSelected: boolean;
  onTap: (index: number) => void;
  onDoubleTap: (index: number) => void;
}

function Slot({ item, index, isSelected, onTap, onDoubleTap }: SlotProps) {
  // Exclusive() gives the double tap priority, so the single tap only fires
  // once gesture-handler has ruled a second tap out. Hand-rolled tap timing
  // would have to delay every select by the double-tap window instead.
  const gesture = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Tap()
          .numberOfTaps(2)
          .onEnd(() => onDoubleTap(index))
          .runOnJS(true),
        Gesture.Tap()
          .onEnd(() => onTap(index))
          .runOnJS(true)
      ),
    [index, onTap, onDoubleTap]
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.slot, isSelected && styles.slotSelected]}>
        {item && (
          <>
            <View style={[styles.itemChip, { backgroundColor: item.color }]}>
              <Text style={styles.itemShort}>{item.short}</Text>
            </View>
            {item.qty > 1 && <Text style={styles.qty}>{item.qty}</Text>}
            {/* Affordance for "this one does something when double-tapped" */}
            {item.use && <View style={styles.usableMark} />}
          </>
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
}

export function Inventory({ onConsume }: InventoryProps) {
  const isOpen = useInventoryStore((s) => s.isOpen);
  const slots = useInventoryStore((s) => s.slots);
  const selected = useInventoryStore((s) => s.selected);
  const toggle = useInventoryStore((s) => s.toggle);
  const tapSlot = useInventoryStore((s) => s.tapSlot);
  const consumeItem = useInventoryStore((s) => s.consumeItem);

  const handleDoubleTap = useCallback(
    (index: number) => {
      const use = consumeItem(index);
      if (use) onConsume(use);
    },
    [consumeItem, onConsume]
  );

  const used = slots.filter(Boolean).length;

  return (
    <>
      <Pressable style={styles.toggle} onPress={toggle}>
        <Text style={styles.toggleText}>{isOpen ? "CLOSE" : "BAG"}</Text>
      </Pressable>

      {isOpen && (
        <View style={styles.panel}>
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
                onTap={tapSlot}
                onDoubleTap={handleDoubleTap}
              />
            ))}
          </View>

          <Text style={styles.hint}>
            {selected === null
              ? "Tap to pick up · double-tap to use"
              : "Tap a slot to move it there"}
          </Text>
        </View>
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
});
