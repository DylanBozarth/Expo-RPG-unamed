import { Stack } from 'expo-router';
import { Colors } from '../styling/theme';

const headerStyle = {
  backgroundColor: Colors.prussianBlue,
};

const headerOptions = {
  headerStyle,
  headerTintColor: Colors.white,
  headerTitleStyle: { fontWeight: '600' as const },
};

export default function RootLayout() {
  return (
    <Stack screenOptions={headerOptions}>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="pages/map" options={{ title: 'Map' }} />
    </Stack>
  );
}
