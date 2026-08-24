import { create } from "zustand";

// ---------------------------------------------------------------------------
// Grid shape
// ---------------------------------------------------------------------------

export const INVENTORY_COLS = 5;
export const INVENTORY_ROWS = 4;
export const INVENTORY_SIZE = INVENTORY_COLS * INVENTORY_ROWS;

export const MAX_STACK = 99;

/** Which vital bar an item tops up when consumed. */
export type VitalKind = "hunger" | "thirst";

export interface ItemUse {
  vital: VitalKind;
  /** Vital points restored per unit consumed. */
  amount: number;
}

export interface InventoryItem {
  /** Stackable identity — two items with the same id merge into one slot. */
  id: string;
  name: string;
  /** Short glyph shown in the slot until there are real icons. */
  short: string;
  color: string;
  qty: number;
  /** Omitted for items that aren't consumable. */
  use?: ItemUse;
}

// Placeholder contents so the grid is visible and testable. Drop this and
// start from `emptySlots()` once items come from the world.
const STARTER_ITEMS: InventoryItem[] = [
  {
    id: "ration",
    name: "Ration Pack",
    short: "RTN",
    color: "#8bc34a",
    qty: 3,
    use: { vital: "hunger", amount: 35 },
  },
  {
    id: "canteen",
    name: "Canteen",
    short: "H2O",
    color: "#4cc9f0",
    qty: 2,
    use: { vital: "thirst", amount: 45 },
  },
  { id: "cell", name: "Power Cell", short: "CEL", color: "#fca311", qty: 12 },
  { id: "scrap", name: "Scrap Alloy", short: "SCR", color: "#3d3d4d", qty: 24 },
];

function emptySlots(): (InventoryItem | null)[] {
  return new Array<InventoryItem | null>(INVENTORY_SIZE).fill(null);
}

function seededSlots(): (InventoryItem | null)[] {
  const slots = emptySlots();
  STARTER_ITEMS.forEach((item, i) => {
    slots[i] = item;
  });
  return slots;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface InventoryState {
  isOpen: boolean;
  slots: (InventoryItem | null)[];
  /** Slot index the player has picked up, awaiting a destination. */
  selected: number | null;

  toggle: () => void;
  close: () => void;

  /** Tap handling: pick a slot, then tap another to swap into it. */
  tapSlot: (index: number) => void;

  /**
   * Consume one unit from a slot. Returns the effect to apply, or null if the
   * slot is empty or the item isn't consumable — the caller owns the vitals.
   */
  consumeItem: (index: number) => ItemUse | null;

  /** Stacks onto a matching slot, else takes the first empty one. */
  addItem: (item: InventoryItem) => boolean;
  removeItem: (index: number) => void;
  reset: () => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  isOpen: false,
  slots: seededSlots(),
  selected: null,

  toggle: () =>
    set((s) => ({ isOpen: !s.isOpen, selected: s.isOpen ? null : s.selected })),

  close: () => set({ isOpen: false, selected: null }),

  tapSlot: (index) => {
    const { selected, slots } = get();

    if (selected === null) {
      // Nothing held — only pick up a slot that has something in it
      if (slots[index]) set({ selected: index });
      return;
    }

    if (selected === index) {
      set({ selected: null });
      return;
    }

    const next = [...slots];
    const held = next[selected];
    const target = next[index];

    // Same item type — merge instead of swapping, up to the stack cap
    if (held && target && held.id === target.id) {
      const room = MAX_STACK - target.qty;
      const moved = Math.min(room, held.qty);
      if (moved > 0) {
        next[index] = { ...target, qty: target.qty + moved };
        next[selected] =
          held.qty - moved > 0 ? { ...held, qty: held.qty - moved } : null;
        set({ slots: next, selected: null });
        return;
      }
    }

    next[index] = held;
    next[selected] = target;
    set({ slots: next, selected: null });
  },

  consumeItem: (index) => {
    const { slots, selected } = get();
    const item = slots[index];
    if (!item?.use) return null;

    const next = [...slots];
    next[index] = item.qty > 1 ? { ...item, qty: item.qty - 1 } : null;

    set({
      slots: next,
      // Dropping the last unit invalidates a selection pointing at this slot
      selected: next[index] === null && selected === index ? null : selected,
    });

    return item.use;
  },

  addItem: (item) => {
    const { slots } = get();
    const next = [...slots];

    // Top up existing stacks first
    let remaining = item.qty;
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const slot = next[i];
      if (!slot || slot.id !== item.id || slot.qty >= MAX_STACK) continue;
      const moved = Math.min(MAX_STACK - slot.qty, remaining);
      next[i] = { ...slot, qty: slot.qty + moved };
      remaining -= moved;
    }

    // Spill the rest into empty slots
    for (let i = 0; i < next.length && remaining > 0; i++) {
      if (next[i]) continue;
      const moved = Math.min(MAX_STACK, remaining);
      next[i] = { ...item, qty: moved };
      remaining -= moved;
    }

    set({ slots: next });
    return remaining === 0; // false = inventory full, some was dropped
  },

  removeItem: (index) =>
    set((s) => {
      const next = [...s.slots];
      next[index] = null;
      return { slots: next, selected: s.selected === index ? null : s.selected };
    }),

  reset: () => set({ slots: emptySlots(), selected: null, isOpen: false }),
}));
