import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, GlobalStyles } from '../styling/theme';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={GlobalStyles.text}>Hello World</Text>
        <TouchableOpacity style={GlobalStyles.button} onPress={() => router.push('/pages/map')}>
          <Text style={GlobalStyles.buttonText}>Go to Map</Text>
        </TouchableOpacity>
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
