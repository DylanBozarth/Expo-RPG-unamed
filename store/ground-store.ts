import { useMemo } from "react";
import { create } from "zustand";
import { useInventoryStore, type InventoryItem } from "./inventory-store";

/** Which map an item is lying on — a dropped item only exists on its own map. */
export type SceneId = "map" | "house";

export interface GroundItem {
  /** Stable identity: item ids repeat, so piles need a key of their own. */
  key: number;
  scene: SceneId;
  /** The whole stack that left the slot, qty included. */
  item: InventoryItem;
  /** World px — the point the label is centred on. */
  x: number;
  y: number;
}

// Module scope, like the vitals: a run's dropped items outlive a screen change.
let nextKey = 1;

interface GroundState {
  items: GroundItem[];

  /** Puts a stack on the ground at a world point. */
  drop: (scene: SceneId, item: InventoryItem, x: number, y: number) => void;

  /**
   * Moves a pile back into the inventory. Whatever doesn't fit stays on the
   * ground, so a full bag can't quietly delete the remainder.
   */
  pickUp: (key: number) => void;

  clear: () => void;
}

export const useGroundStore = create<GroundState>((set, get) => ({
  items: [],

  drop: (scene, item, x, y) =>
    set((s) => ({
      items: [...s.items, { key: nextKey++, scene, item, x, y }],
    })),

  pickUp: (key) => {
    const pile = get().items.find((g) => g.key === key);
    if (!pile) return;

    const leftOver = useInventoryStore.getState().addItem(pile.item);

    set((s) => ({
      items: s.items.flatMap((g) => {
        if (g.key !== key) return [g];
        if (leftOver === 0) return [];
        return [{ ...g, item: { ...g.item, qty: leftOver } }];
      }),
    }));
  },

  clear: () => set({ items: [] }),
}));

/**
 * Items on one map. Filtered in a memo rather than in the selector — a selector
 * that builds a new array every call re-renders forever under zustand v5.
 */
export function useSceneGroundItems(scene: SceneId): GroundItem[] {
  const items = useGroundStore((s) => s.items);
  return useMemo(() => items.filter((g) => g.scene === scene), [items, scene]);
}
