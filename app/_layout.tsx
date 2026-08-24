import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors } from '../styling/theme';

const headerOptions = {
  headerStyle: { backgroundColor: Colors.prussianBlue },
  headerTintColor: Colors.white,
  headerTitleStyle: { fontWeight: '600' as const },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack screenOptions={headerOptions}>
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="pages/map" options={{ headerShown: false }} />
        <Stack.Screen name="pages/house" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
