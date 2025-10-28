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
  const { isLoading, isAuthenticated, user, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setLoginError('Please enter email and password');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');

    try {
      await login({ email, password });
      Alert.alert('Success', 'Login successful!');
      setEmail('');
      setPassword('');
    } catch (error: any) {
      const errorMessage = error.message || 'Login failed. Please try again.';
      setLoginError(errorMessage);
      Alert.alert('Login Failed', errorMessage);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      Alert.alert('Logged Out', 'You have been logged out successfully.');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

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
            <Text style={styles.statusText}>💰 Currency: {user.base_currency}</Text>
            <Text style={styles.statusText}>🆔 User ID: {user.id.substring(0, 8)}...</Text>
            <Button
              title="Logout"
              variant="secondary"
              size="small"
              onPress={handleLogout}
              style={styles.logoutButton}
            />
          </>
        ) : (
          <Text style={styles.statusText}>❌ Not logged in</Text>
        )}
      </Card>

      {/* Login Form (shown when not authenticated) */}
      {!isAuthenticated && (
        <Card variant="outlined" style={styles.loginCard}>
          <Text style={styles.cardTitle}>Login</Text>
          <Text style={styles.loginHint}>
            Test with existing user or create one in backend
          </Text>
          
          <Input
            label="Email"
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            error={loginError}
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            isPassword
          />

          <Button
            title={isLoggingIn ? "Logging in..." : "Login"}
            onPress={handleLogin}
            loading={isLoggingIn}
            disabled={!email || !password}
            size="large"
          />
        </Card>
      )}

      {/* User Info (shown when authenticated) */}
      {isAuthenticated && user && (
        <Card variant="outlined" style={styles.userCard}>
          <Text style={styles.cardTitle}>Welcome Back! 👋</Text>
          <Text style={styles.welcomeText}>
            You are successfully logged in and ready to manage your finances.
          </Text>
          <Text style={styles.comingSoonText}>
            🚧 Transaction screens coming next...
          </Text>
        </Card>
      )}

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
  loginCard: {
    marginBottom: 16,
  },
  userCard: {
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
    marginBottom: 6,
  },
  loginHint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  logoutButton: {
    marginTop: 12,
  },
  welcomeText: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 12,
    lineHeight: 20,
  },
  comingSoonText: {
    fontSize: 14,
    color: '#0ea5e9',
    fontWeight: '600',
    textAlign: 'center',
  },
});
