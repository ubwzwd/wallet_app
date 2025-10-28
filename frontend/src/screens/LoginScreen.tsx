import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Screen, Card, Button, Input } from '@/components';
import { useAuth } from '@/store/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const newErrors: { email?: string; password?: string } = {};

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      await login({ email: email.trim(), password });
      // Navigation will be handled by App.tsx based on auth state
    } catch (error: any) {
      const errorMessage = error.message || 'Login failed. Please try again.';
      Alert.alert('Login Failed', errorMessage);
      setErrors({ password: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logo}>💰</Text>
          <Text style={styles.title}>Wallet App</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

        <Card variant="elevated" style={styles.card}>
          <Input
            label="Email"
            placeholder="Enter your email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            isPassword
            error={errors.password}
          />

          <Button
            title={isLoading ? 'Signing in...' : 'Sign In'}
            onPress={handleLogin}
            loading={isLoading}
            disabled={isLoading}
            size="large"
            style={styles.loginButton}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Demo Account:</Text>
          <Text style={styles.demoText}>user@test.com / password123</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 64,
    marginBottom: 16,
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
  card: {
    marginHorizontal: 16,
  },
  loginButton: {
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  demoText: {
    fontSize: 12,
    color: '#0ea5e9',
    fontWeight: '600',
  },
});

