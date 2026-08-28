import { makeMutable, type SharedValue } from "react-native-reanimated";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// The four stats
// ---------------------------------------------------------------------------

export type StatId = "strength" | "endurance" | "vitality" | "piety";

/** Fixed order — creation screen, HUD and sheet all read the stats from this. */
export const STAT_IDS: StatId[] = [
  "strength",
  "endurance",
  "vitality",
  "piety",
];

export interface StatMeta {
  label: string;
  /** Three-letter form for the HUD, where there is no room for the label. */
  short: string;
}

export const STATS: Record<StatId, StatMeta> = {
  strength: { label: "Strength", short: "STR" },
  endurance: { label: "Endurance", short: "END" },
  vitality: { label: "Vitality", short: "VIT" },
  piety: { label: "Piety", short: "PIE" },
};

// ---------------------------------------------------------------------------
// Point buy
// ---------------------------------------------------------------------------

export const STAT_MIN = 1;
export const STAT_MAX = 10;
/** Every stat starts here, and the pool below is spent on top of it. */
export const STAT_BASE = 1;
export const STAT_POOL = 2;

export type Stats = Record<StatId, number>;

export function baseStats(): Stats {
  return { strength: STAT_BASE, endurance: STAT_BASE, vitality: STAT_BASE, piety: STAT_BASE };
}

function spent(stats: Stats): number {
  return STAT_IDS.reduce((sum, id) => sum + (stats[id] - STAT_BASE), 0);
}

// ---------------------------------------------------------------------------
// UI-thread mirror
// ---------------------------------------------------------------------------

/**
 * Plumbing for reading stats from a worklet — a zustand store can't be, and
 * the frame loop runs on the UI thread. Mirrored into module-scope shared
 * values, the same trick the vitals use and for the same reason: module scope
 * is what makes them outlive a screen change.
 *
 * Nothing reads these yet. Read them only from worklets; everywhere else, use
 * the store.
 */
export const statValues: Record<StatId, SharedValue<number>> = {
  strength: makeMutable(STAT_BASE),
  endurance: makeMutable(STAT_BASE),
  vitality: makeMutable(STAT_BASE),
  piety: makeMutable(STAT_BASE),
};

function syncStatValues(stats: Stats) {
  for (const id of STAT_IDS) statValues[id].value = stats[id];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CharacterState {
  /** False until the creation screen commits — the map can gate on this. */
  created: boolean;
  name: string;
  /** The live stats the game reads. Only `commit` changes these. */
  stats: Stats;

  /** Creation-screen scratch state, kept out of `stats` so a half-finished
   * allocation can't leak into a run that's already going. */
  draftName: string;
  draftStats: Stats;

  setDraftName: (name: string) => void;
  /** Spends or refunds a point. Ignored when the pool is empty or at a bound. */
  adjustDraft: (id: StatId, delta: number) => void;
  /** Puts the pool back and clears the draft to the base spread. */
  resetDraft: () => void;
  /** Spreads the pool at random — a "surprise me" for testing and for players. */
  randomizeDraft: (rolls?: number[]) => void;

  /** Locks the draft in as the character. No-op while points are unspent. */
  commit: () => boolean;

  /** Wipes the character. Call when starting over, not when changing maps. */
  clear: () => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  created: false,
  name: "",
  stats: baseStats(),

  draftName: "",
  draftStats: baseStats(),

  setDraftName: (name) => set({ draftName: name }),

  adjustDraft: (id, delta) =>
    set((s) => {
      const next = s.draftStats[id] + delta;
      if (next < STAT_MIN || next > STAT_MAX) return s;
      const draftStats = { ...s.draftStats, [id]: next };
      if (spent(draftStats) > STAT_POOL) return s;
      return { draftStats };
    }),

  resetDraft: () => set({ draftStats: baseStats() }),

  /**
   * `rolls` is injected so the caller owns the randomness — the store stays
   * pure, and a test can hand it a fixed sequence.
   */
  randomizeDraft: (rolls) =>
    set(() => {
      const draftStats = baseStats();
      for (let i = 0; i < STAT_POOL; i++) {
        const r = rolls ? rolls[i % rolls.length] : Math.random();
        // Retry into the next stat when the picked one is already capped
        for (let attempt = 0; attempt < STAT_IDS.length; attempt++) {
          const id =
            STAT_IDS[(Math.floor(r * STAT_IDS.length) + attempt) % STAT_IDS.length];
          if (draftStats[id] < STAT_MAX) {
            draftStats[id] += 1;
            break;
          }
        }
      }
      return { draftStats };
    }),

  commit: () => {
    const { draftStats, draftName } = get();
    if (spent(draftStats) !== STAT_POOL) return false;

    const stats = { ...draftStats };
    syncStatValues(stats);
    set({
      created: true,
      name: draftName.trim() || "Nameless",
      stats,
    });
    return true;
  },

  clear: () => {
    const stats = baseStats();
    syncStatValues(stats);
    set({
      created: false,
      name: "",
      stats,
      draftName: "",
      draftStats: baseStats(),
    });
  },
}));

// ---------------------------------------------------------------------------
// Reading stats outside React
// ---------------------------------------------------------------------------

/** The committed stats, for callbacks and event handlers. */
export function getStats(): Stats {
  return useCharacterStore.getState().stats;
}

/** Points remaining in a draft — what the creation screen counts down. */
export function remainingPoints(stats: Stats): number {
  return STAT_POOL - spent(stats);
}

/**
 * A story/gameplay gate: does the character clear `difficulty` on this stat?
 * Deterministic on purpose — a dialog branch that rerolls every time it's
 * opened reads as a bug, not as tension.
 */
export function passesCheck(id: StatId, difficulty: number): boolean {
  return getStats()[id] >= difficulty;
}
