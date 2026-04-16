import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Screen, Card, Button } from '@/components';
import { useAuth } from '@/store/AuthContext';
import { FinanceSourcesScreen } from './FinanceSourcesScreen';
import { FinanceSourceFormScreen } from './FinanceSourceFormScreen';
import { TransactionsScreen } from './TransactionsScreen';
import { TransactionFormScreen } from './TransactionFormScreen';
import type { FinanceSource, Transaction } from '@/types/api';

type HomeView = 'main' | 'finance-sources' | 'add-source' | 'edit-source' | 'transactions' | 'add-transaction' | 'edit-transaction';

export function HomeScreen() {
  const { user, logout, isAuthenticated } = useAuth();
  const [currentView, setCurrentView] = useState<HomeView>('main');
  const [selectedSource, setSelectedSource] = useState<FinanceSource | undefined>();
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | undefined>();

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

  // Show Finance Sources screen
  if (currentView === 'finance-sources') {
    return (
      <FinanceSourcesScreen
        onCreatePress={() => setCurrentView('add-source')}
        onEditPress={(source) => {
          setSelectedSource(source);
          setCurrentView('edit-source');
        }}
        onBackPress={() => setCurrentView('main')}
      />
    );
  }

  // Show Add Finance Source form
  if (currentView === 'add-source') {
    return (
      <FinanceSourceFormScreen
        onSuccess={() => setCurrentView('finance-sources')}
        onCancel={() => setCurrentView('finance-sources')}
      />
    );
  }

  // Show Edit Finance Source form
  if (currentView === 'edit-source' && selectedSource) {
    return (
      <FinanceSourceFormScreen
        source={selectedSource}
        onSuccess={() => {
          setSelectedSource(undefined);
          setCurrentView('finance-sources');
        }}
        onCancel={() => {
          setSelectedSource(undefined);
          setCurrentView('finance-sources');
        }}
      />
    );
  }

  // Show Transactions screen
  if (currentView === 'transactions') {
    return (
      <TransactionsScreen
        onCreatePress={() => setCurrentView('add-transaction')}
        onEditPress={(transaction) => {
          setSelectedTransaction(transaction);
          setCurrentView('edit-transaction');
        }}
        onBackPress={() => setCurrentView('main')}
      />
    );
  }

  // Show Add Transaction form
  if (currentView === 'add-transaction') {
    return (
      <TransactionFormScreen
        onSuccess={() => setCurrentView('transactions')}
        onCancel={() => setCurrentView('transactions')}
      />
    );
  }

  // Show Edit Transaction form
  if (currentView === 'edit-transaction' && selectedTransaction) {
    return (
      <TransactionFormScreen
        transaction={selectedTransaction}
        onSuccess={() => {
          setSelectedTransaction(undefined);
          setCurrentView('transactions');
        }}
        onCancel={() => {
          setSelectedTransaction(undefined);
          setCurrentView('transactions');
        }}
      />
    );
  }

  // Main Home Screen
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
        </Card>

        {/* Quick Actions Card */}
        <Card variant="outlined" style={styles.card}>
          <Text style={styles.cardTitle}>Quick Actions</Text>
          <Button
            title="💳 Manage Finance Sources"
            variant="secondary"
            onPress={() => setCurrentView('finance-sources')}
            style={styles.quickButton}
          />
          <Button
            title="💰 View Transactions"
            variant="secondary"
            onPress={() => setCurrentView('transactions')}
            style={styles.quickButton}
          />
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
  quickButton: {
    marginBottom: 8,
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

