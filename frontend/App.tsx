import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>🎉 Wallet App</Text>
        <Text style={styles.subtitle}>Frontend environment is ready!</Text>
        <Text style={styles.description}>
          Expo + TypeScript ✅
        </Text>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#0ea5e9',
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
  },
  description: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.9,
  },
});
