import { Platform, StyleSheet } from 'react-native';

export const Colors = {
  black: '#000000',
  prussianBlue: '#14213d',
  orange: '#fca311',
  alabaster: '#e5e5e5',
  white: '#ffffff',
};

export const GlobalStyles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  text: {
    color: Colors.white,
  },
  card: {
    backgroundColor: Colors.prussianBlue,
    borderRadius: 8,
    padding: 16,
  },
  outline: {
    borderWidth: 1,
    borderColor: Colors.prussianBlue,
    borderRadius: 8,
  },
  accentText: {
    color: Colors.orange,
  },
  mutedText: {
    color: Colors.alabaster,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.alabaster,
  },
  button: {
    backgroundColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: Colors.orange,
    fontWeight: '600',
  },
});

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
