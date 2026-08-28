import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  remainingPoints,
  STAT_IDS,
  STAT_MAX,
  STAT_MIN,
  STAT_POOL,
  STATS,
  useCharacterStore,
  type StatId,
} from "../../store/character-store";
import { resetVitals } from "../../components/vitals/vitals-state";
import { Colors } from "../../styling/theme";

// ---------------------------------------------------------------------------
// One stat row: name, dots, and the two steppers
// ---------------------------------------------------------------------------

interface StatRowProps {
  id: StatId;
  value: number;
  /** False when the pool is empty — the plus greys out rather than vanishing. */
  canRaise: boolean;
  onAdjust: (id: StatId, delta: number) => void;
}

function StatRow({ id, value, canRaise, onAdjust }: StatRowProps) {
  const meta = STATS[id];
  const canLower = value > STAT_MIN;

  return (
    <View style={styles.statRow}>
      <View style={styles.statLabels}>
        <Text style={styles.statName}>{meta.label}</Text>
      </View>

      <View style={styles.stepper}>
        <Stepper
          glyph="−"
          enabled={canLower}
          onPress={() => onAdjust(id, -1)}
        />
        <Text style={styles.statValue}>{value}</Text>
        <Stepper
          glyph="+"
          enabled={canRaise && value < STAT_MAX}
          onPress={() => onAdjust(id, 1)}
        />
      </View>

      {/* Pips, so the spread reads at a glance without doing arithmetic */}
      <View style={styles.pips}>
        {Array.from({ length: STAT_MAX - STAT_MIN + 1 }, (_, i) => (
          <View
            key={i}
            style={[styles.pip, i <= value - STAT_MIN && styles.pipFilled]}
          />
        ))}
      </View>
    </View>
  );
}

function Stepper({
  glyph,
  enabled,
  onPress,
}: {
  glyph: string;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.stepButton, !enabled && styles.stepButtonOff]}
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
    >
      <Text style={[styles.stepGlyph, !enabled && styles.stepGlyphOff]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CharacterScreen() {
  const router = useRouter();

  const draftName = useCharacterStore((s) => s.draftName);
  const draftStats = useCharacterStore((s) => s.draftStats);
  const setDraftName = useCharacterStore((s) => s.setDraftName);
  const adjustDraft = useCharacterStore((s) => s.adjustDraft);
  const resetDraft = useCharacterStore((s) => s.resetDraft);
  const randomizeDraft = useCharacterStore((s) => s.randomizeDraft);
  const commit = useCharacterStore((s) => s.commit);

  const left = remainingPoints(draftStats);
  const ready = left === 0;

  function begin() {
    if (!commit()) return;
    // A new character is a new run, so the bars start full. Vitals live at
    // module scope and would otherwise carry over from a previous character.
    resetVitals();
    // replace, not push — there is no going back into creation mid-run
    router.replace("/pages/map");
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>WHO ARE YOU?</Text>
          <Text style={[styles.points, ready && styles.pointsDone]}>
            {left} / {STAT_POOL} POINTS LEFT
          </Text>
        </View>

        <TextInput
          style={styles.nameInput}
          value={draftName}
          onChangeText={setDraftName}
          placeholder="Name"
          placeholderTextColor="rgba(229, 229, 229, 0.35)"
          maxLength={20}
          autoCorrect={false}
          returnKeyType="done"
        />

        <View style={styles.stats}>
          {STAT_IDS.map((id) => (
            <StatRow
              key={id}
              id={id}
              value={draftStats[id]}
              canRaise={left > 0}
              onAdjust={adjustDraft}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.secondary} onPress={() => randomizeDraft()}>
            <Text style={styles.secondaryText}>RANDOM</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={resetDraft}>
            <Text style={styles.secondaryText}>RESET</Text>
          </Pressable>
          <Pressable
            style={[styles.primary, !ready && styles.primaryOff]}
            onPress={ready ? begin : undefined}
            disabled={!ready}
          >
            <Text style={styles.primaryText}>
              {ready ? "BEGIN" : "SPEND YOUR POINTS"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050508",
  },
  scroll: {
    paddingHorizontal: 40,
    paddingVertical: 20,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: {
    color: Colors.alabaster,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 4,
  },
  points: {
    color: Colors.orange,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  pointsDone: {
    color: "rgba(229, 229, 229, 0.45)",
  },
  nameInput: {
    color: Colors.white,
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(20, 33, 61, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.2)",
    borderRadius: 8,
  },
  stats: {
    gap: 8,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(20, 33, 61, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.12)",
    borderRadius: 10,
  },
  statLabels: {
    flex: 1,
    gap: 2,
  },
  statName: {
    color: Colors.alabaster,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(252, 163, 17, 0.18)",
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  stepButtonOff: {
    backgroundColor: "transparent",
    borderColor: "rgba(229, 229, 229, 0.15)",
  },
  stepGlyph: {
    color: Colors.orange,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  stepGlyphOff: {
    color: "rgba(229, 229, 229, 0.25)",
  },
  statValue: {
    width: 26,
    textAlign: "center",
    color: Colors.white,
    fontSize: 20,
    fontWeight: "800",
  },
  pips: {
    width: 84,
    flexDirection: "row",
    gap: 3,
  },
  pip: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(229, 229, 229, 0.18)",
  },
  pipFilled: {
    backgroundColor: Colors.orange,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  secondary: {
    borderWidth: 1,
    borderColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  secondaryText: {
    color: Colors.orange,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  primary: {
    flex: 1,
    backgroundColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryOff: {
    backgroundColor: "rgba(252, 163, 17, 0.25)",
  },
  primaryText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
});
