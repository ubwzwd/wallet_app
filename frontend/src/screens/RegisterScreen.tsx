import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { Screen, Card, Button, Input } from '@/components';
import { useAuth } from '@/store/AuthContext';

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'SGD', name: 'Singapore Dollar' },
];

export function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const validate = () => {
    const newErrors: {
      email?: string;
      password?: string;
      confirmPassword?: string;
    } = {};

    // Email validation
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    // Password validation
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    // Confirm password validation
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      await register({
        email: email.trim(),
        password,
        base_currency: baseCurrency,
      });
      Alert.alert('Success', 'Account created successfully!');
      // Navigation will be handled by App.tsx based on auth state
    } catch (error: any) {
      const errorMessage = error.message || 'Registration failed. Please try again.';
      Alert.alert('Registration Failed', errorMessage);
      
      // If email already registered, show error on email field
      if (errorMessage.toLowerCase().includes('email')) {
        setErrors({ email: errorMessage });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logo}>💰</Text>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start managing your finances</Text>
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
            placeholder="At least 6 characters"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            isPassword
            error={errors.password}
            hint="Minimum 6 characters"
          />

          <Input
            label="Confirm Password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }}
            isPassword
            error={errors.confirmPassword}
          />

          <View style={styles.currencySection}>
            <Text style={styles.currencyLabel}>Base Currency</Text>
            <Text style={styles.currencyHint}>
              This will be your default currency for reporting
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyList}>
              {CURRENCIES.map((currency) => (
                <Button
                  key={currency.code}
                  title={currency.code}
                  variant={baseCurrency === currency.code ? 'primary' : 'secondary'}
                  size="small"
                  onPress={() => setBaseCurrency(currency.code)}
                  style={styles.currencyButton}
                />
              ))}
            </ScrollView>
          </View>

          <Button
            title={isLoading ? 'Creating account...' : 'Create Account'}
            onPress={handleRegister}
            loading={isLoading}
            disabled={isLoading}
            size="large"
            style={styles.registerButton}
          />
        </Card>
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
  currencySection: {
    marginBottom: 16,
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  currencyHint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
  },
  currencyList: {
    flexDirection: 'row',
  },
  currencyButton: {
    marginRight: 8,
  },
  registerButton: {
    marginTop: 8,
  },
});

