import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "../../styling/theme";

interface DialogBoxProps {
  speaker: string;
  line: string;
  onClose: () => void;
  /** Rendered under the line — stat readouts, reply buttons, whatever a given
   * conversation needs. The box grows to fit it. */
  children?: ReactNode;
}

/**
 * Conversation panel along the bottom of the screen. Only covers its own box,
 * so the map stays visible behind it — movement is locked by the caller, not by
 * swallowing touches here.
 */
export function DialogBox({ speaker, line, onClose, children }: DialogBoxProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <View style={styles.header}>
          <Text style={styles.speaker}>{speaker}</Text>
          <Pressable style={styles.close} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeMark}>✕</Text>
          </Pressable>
        </View>

        <Text style={styles.line}>{line}</Text>

        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
  },
  box: {
    backgroundColor: "rgba(5, 5, 8, 0.95)",
    borderWidth: 1.5,
    borderColor: Colors.orange,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 10,
    minHeight: 108,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speaker: {
    color: Colors.orange,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  close: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(229, 229, 229, 0.35)",
  },
  closeMark: {
    color: Colors.alabaster,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
  },
  line: {
    color: Colors.alabaster,
    fontSize: 16,
    lineHeight: 22,
  },
});
