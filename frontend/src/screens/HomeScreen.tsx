import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Screen, Card, Button } from '@/components';
import { useAuth } from '@/store/AuthContext';

export function HomeScreen() {
  const { user, logout, isAuthenticated } = useAuth();

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
            } catch (error) {
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };

  if (!isAuthenticated || !user) {
    return (
      <Screen>
        <View style={styles.container}>
          <Text style={styles.errorText}>Not authenticated</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Welcome Back! 👋</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        {/* User Info Card */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>Account Information</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email:</Text>
            <Text style={styles.infoValue}>{user.email}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Base Currency:</Text>
            <Text style={styles.infoValue}>{user.base_currency}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>User ID:</Text>
            <Text style={styles.infoValue}>{user.id.substring(0, 8)}...</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Member Since:</Text>
            <Text style={styles.infoValue}>
              {new Date(user.created_at).toLocaleDateString()}
            </Text>
          </View>
        </Card>

        {/* Coming Soon Card */}
        <Card variant="outlined" style={styles.card}>
          <Text style={styles.cardTitle}>🚧 Coming Soon</Text>
          <Text style={styles.comingSoonText}>
            • Finance Sources Management{'\n'}
            • Transaction Tracking{'\n'}
            • Reports & Analytics{'\n'}
            • Multi-currency Support
          </Text>
        </Card>

        {/* Logout Button */}
        <Button
          title="Logout"
          variant="secondary"
          onPress={handleLogout}
          style={styles.logoutButton}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    color: '#6b7280',
  },
  card: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  comingSoonText: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 24,
  },
  logoutButton: {
    marginTop: 'auto',
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
  },
});

