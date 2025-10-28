import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ActivityIndicator, Alert } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/store/AuthContext';
import { queryClient } from '@/utils/queryClient';
import { Screen, Card, Button, Input } from '@/components';
import { useState } from 'react';

/**
 * Main App Content
 */
function AppContent() {
  const { isLoading, isAuthenticated, user } = useAuth();
  const [testInput, setTestInput] = useState('');
  const [testPassword, setTestPassword] = useState('');

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>🎉 Wallet App</Text>
        <Text style={styles.subtitle}>UI Components Demo</Text>
      </View>

      {/* Auth Status Card */}
      <Card variant="elevated" style={styles.statusCard}>
        <Text style={styles.cardTitle}>Auth Status</Text>
        {isAuthenticated && user ? (
          <>
            <Text style={styles.statusText}>✅ Logged in as: {user.email}</Text>
            <Text style={styles.statusText}>Currency: {user.base_currency}</Text>
          </>
        ) : (
          <Text style={styles.statusText}>❌ Not logged in</Text>
        )}
      </Card>

      {/* Components Demo Card */}
      <Card variant="outlined" style={styles.demoCard}>
        <Text style={styles.cardTitle}>Components Demo</Text>
        
        <Input
          label="Email Input"
          placeholder="Enter your email"
          value={testInput}
          onChangeText={setTestInput}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Input
          label="Password Input"
          placeholder="Enter your password"
          value={testPassword}
          onChangeText={setTestPassword}
          isPassword
        />

        <View style={styles.buttonRow}>
          <Button
            title="Primary"
            onPress={() => Alert.alert('Primary Button', 'You pressed the primary button!')}
            style={styles.button}
          />
          <Button
            title="Secondary"
            variant="secondary"
            onPress={() => Alert.alert('Secondary', 'Secondary button pressed!')}
            style={styles.button}
          />
        </View>

        <Button
          title="Danger Button"
          variant="danger"
          size="large"
          onPress={() => Alert.alert('Danger', 'Danger button pressed!')}
        />
      </Card>

      <StatusBar style="auto" />
    </Screen>
  );
}

/**
 * Root App Component with Providers
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
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
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
  },
  statusCard: {
    marginBottom: 16,
  },
  demoCard: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  button: {
    flex: 1,
  },
});
