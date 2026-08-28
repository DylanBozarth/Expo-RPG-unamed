import { StyleSheet, Text, View } from "react-native";
import {
  STAT_IDS,
  STATS,
  useCharacterStore,
} from "../../store/character-store";
import { Colors } from "../../styling/theme";

/**
 * The character's name and four stats, as a plain block with no positioning of
 * its own — the caller decides where it appears. Drop it into a dialog, a menu,
 * a level-up screen.
 *
 * Reads the character store, which is module scope, so it shows the same
 * character on every map.
 */
export function StatSheet() {
  const name = useCharacterStore((s) => s.name);
  const stats = useCharacterStore((s) => s.stats);
  const created = useCharacterStore((s) => s.created);

  // Nothing to show before creation — e.g. a map entered straight from a link
  if (!created) return null;

  return (
    <View style={styles.sheet}>
      <Text style={styles.name}>{name}</Text>

      <View style={styles.row}>
        {STAT_IDS.map((id) => (
          <View key={id} style={styles.stat}>
            <Text style={styles.label}>{STATS[id].short}</Text>
            <Text style={styles.value}>{stats[id]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: 6,
  },
  name: {
    color: "rgba(229, 229, 229, 0.55)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  stat: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "rgba(20, 33, 61, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.18)",
  },
  label: {
    color: "rgba(229, 229, 229, 0.6)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  value: {
    color: Colors.orange,
    fontSize: 13,
    fontWeight: "800",
  },
});
