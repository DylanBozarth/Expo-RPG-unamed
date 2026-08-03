import { StyleSheet, Text, View } from 'react-native';
import { Colors, GlobalStyles } from '../../styling/theme';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={GlobalStyles.text}>Map</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...GlobalStyles.background,
    backgroundColor: Colors.prussianBlue,
    padding: 24,
  },
});
