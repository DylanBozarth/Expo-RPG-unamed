import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCharacterStore } from '../store/character-store';
import { Colors, GlobalStyles } from '../styling/theme';

export default function HomeScreen() {
  const router = useRouter();
  const created = useCharacterStore((s) => s.created);
  const name = useCharacterStore((s) => s.name);
  const clear = useCharacterStore((s) => s.clear);

  function newCharacter() {
    // Start creation from a clean draft rather than the last run's spread
    clear();
    router.push('/pages/character');
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={GlobalStyles.text}>Hello World</Text>

        <TouchableOpacity style={GlobalStyles.button} onPress={newCharacter}>
          <Text style={GlobalStyles.buttonText}>New Character</Text>
        </TouchableOpacity>

        {/* Only once there's someone to play as — the map's HUD reads the
            character, and the stats gate dialog. */}
        {created && (
          <TouchableOpacity
            style={GlobalStyles.buttonOutline}
            onPress={() => router.push('/pages/map')}
          >
            <Text style={GlobalStyles.buttonOutlineText}>
              Continue as {name}
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    ...GlobalStyles.background,
    backgroundColor: Colors.prussianBlue,
    padding: 24,
    gap: 16,
  },
});
