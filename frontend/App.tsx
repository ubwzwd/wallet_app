import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/store/AuthContext';
import { queryClient } from '@/utils/queryClient';

/**
 * Main App Content
 */
function AppContent() {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>🎉 Wallet App</Text>
        <Text style={styles.subtitle}>Frontend environment is ready!</Text>
        <Text style={styles.description}>
          Expo + TypeScript + Auth Context ✅
        </Text>
        
        {isAuthenticated && user && (
          <View style={styles.userInfo}>
            <Text style={styles.userText}>Logged in as: {user.email}</Text>
            <Text style={styles.userText}>Currency: {user.base_currency}</Text>
          </View>
        )}
        
        {!isAuthenticated && (
          <Text style={styles.statusText}>Not logged in</Text>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
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
  card: {
    backgroundColor: '#0ea5e9',
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 300,
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
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  userInfo: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.3)',
  },
  userText: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
    opacity: 0.8,
  },
});
