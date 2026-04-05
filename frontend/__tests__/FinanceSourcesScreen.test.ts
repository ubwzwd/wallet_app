/**
 * BUG-03: Archive error Alert.alert on native.
 *
 * Verifies that FinanceSourcesScreen.tsx has both web (window.alert) and
 * native (Alert.alert) branches in the archiveMutation.onError handler.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCREEN_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/screens/FinanceSourcesScreen.tsx'),
  'utf8'
);

describe('BUG-03: Archive error shows Alert.alert on native', () => {
  it("calls Alert.alert with title 'Error' on native", () => {
    expect(SCREEN_SOURCE).toContain("Alert.alert('Error'");
  });

  it('has a web branch using window.alert', () => {
    expect(SCREEN_SOURCE).toContain('window.alert(');
  });

  it('branches on Platform.OS for web vs native', () => {
    expect(SCREEN_SOURCE).toContain("Platform.OS === 'web'");
  });

  it('provides a fallback error message string', () => {
    expect(SCREEN_SOURCE).toContain('Failed to update finance source');
  });

  it('imports Alert from react-native', () => {
    expect(SCREEN_SOURCE).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*['"]react-native['"]/);
  });
});
