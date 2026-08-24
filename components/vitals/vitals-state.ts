import { makeMutable } from "react-native-reanimated";
import { MAX_VITAL } from "./vitals";

/**
 * Vitals belong to the player, not to a map — walking through a door doesn't
 * make you less hungry, so these cannot live in a per-screen hook.
 *
 * They're module-scope Reanimated shared values rather than a zustand store
 * because the movement worklet writes them every frame; a JS-thread store
 * would mean 60 bridge hops a second. Module scope is what makes them survive
 * navigating between maps.
 */
export const stamina = makeMutable(MAX_VITAL);
export const hunger = makeMutable(MAX_VITAL);
export const thirst = makeMutable(MAX_VITAL);

/** Bipolar: negative is cold, positive is hot, 0 is comfortable. */
export const temperature = makeMutable(0);

/** Latched when stamina bottoms out, cleared via RECOVER_THRESHOLD. */
export const exhausted = makeMutable(false);

/** Drinking straight from a river fills the water bar right up. */
export function drink() {
  thirst.value = MAX_VITAL;
}

/**
 * A night's rest: stamina back to full, paid for with half the food and water
 * on hand. Clears the exhausted latch too, otherwise the bar would read full
 * while the player was still staggering at EXHAUSTED_SPEED.
 */
export function sleep() {
  stamina.value = MAX_VITAL;
  exhausted.value = false;
  hunger.value = hunger.value / 2;
  thirst.value = thirst.value / 2;
}

/**
 * Start-of-run state. Call this when beginning or restarting a run — NOT when
 * moving between maps, which is the whole point of the above living here.
 */
export function resetVitals() {
  stamina.value = MAX_VITAL;
  hunger.value = MAX_VITAL;
  thirst.value = MAX_VITAL;
  temperature.value = 0;
  exhausted.value = false;
}
