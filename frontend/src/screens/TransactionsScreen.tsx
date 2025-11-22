import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as transactionsApi from '@/api/transactions';
import type { Transaction } from '@/types/api';

interface TransactionsScreenProps {
  onCreatePress: () => void;
  onEditPress: (transaction: Transaction) => void;
  onBackPress: () => void;
}

export function TransactionsScreen({ onCreatePress, onEditPress, onBackPress }: TransactionsScreenProps) {
  const queryClient = useQueryClient();
  const [limit] = useState(50);

  // Fetch transactions
  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: [QUERY_KEYS.TRANSACTIONS],
    queryFn: () => transactionsApi.getTransactions({ limit }),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => transactionsApi.deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.TRANSACTIONS],
        refetchType: 'all',
      });
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to delete transaction';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      }
    },
  });

  const handleDelete = (transaction: Transaction) => {
    const isTransfer = !!transaction.transfer_pair_id;
    const message = isTransfer
      ? `Delete Transfer\n\nThis will delete BOTH sides of the transfer. Continue?`
      : `Delete Transaction\n\nAre you sure you want to delete this transaction?`;

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(message);
      if (confirmed) {
        deleteMutation.mutate(transaction.id);
      }
    }
  };

  const formatAmount = (amount: string, currency: string) => {
    const numAmount = parseFloat(amount);
    const absAmount = Math.abs(numAmount);
    const sign = numAmount >= 0 ? '+' : '-';
    const color = numAmount >= 0 ? '#10b981' : '#ef4444';

    return {
      text: `${sign}${currency} ${absAmount.toFixed(2)}`,
      color,
    };
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const amountDisplay = formatAmount(item.amount, item.currency);
    const dateDisplay = formatDate(item.occurred_at);

    return (
      <Card variant="outlined" style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <View style={styles.transactionInfo}>
            <Text style={styles.transactionDescription}>
              {item.description || 'No description'}
            </Text>
            {item.merchant && (
              <Text style={styles.transactionMerchant}>{item.merchant}</Text>
            )}
            <View style={styles.transactionMeta}>
              <Text style={styles.transactionDate}>{dateDisplay}</Text>
              {item.transfer_pair_id && (
                <View style={styles.transferBadge}>
                  <Text style={styles.transferText}>Transfer</Text>
                </View>
              )}
            </View>
            {item.tags.length > 0 && (
              <View style={styles.tagsContainer}>
                {item.tags.map((tag, index) => (
                  <View key={index} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <View style={styles.transactionAmount}>
            <Text style={[styles.amountText, { color: amountDisplay.color }]}>
              {amountDisplay.text}
            </Text>
          </View>
        </View>

        <View style={styles.transactionActions}>
          <Button
            title="Edit"
            variant="secondary"
            size="small"
            onPress={() => onEditPress(item)}
            style={styles.actionButton}
          />
          <Button
            title="Delete"
            variant="danger"
            size="small"
            onPress={() => handleDelete(item)}
            style={styles.actionButton}
            loading={deleteMutation.isPending}
          />
        </View>
      </Card>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>💰</Text>
      <Text style={styles.emptyTitle}>No Transactions</Text>
      <Text style={styles.emptyText}>
        Start tracking your finances by adding your first transaction.
      </Text>
      <Button
        title="Add Transaction"
        onPress={onCreatePress}
        style={styles.emptyButton}
      />
    </View>
  );

  const renderHeader = () => (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Recent Transactions</Text>
      {transactions && (
        <Text style={styles.summaryCount}>
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
        </Text>
      )}
    </View>
  );

  return (
    <Screen padding={false} scrollable={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Button
              title="← Home"
              variant="secondary"
              size="small"
              onPress={onBackPress}
              style={styles.backButton}
            />
            <Text style={styles.title}>Transactions</Text>
          </View>
          <Button
            title="Add New"
            size="small"
            onPress={onCreatePress}
          />
        </View>

        {/* Transactions List */}
        <FlatList
          data={transactions}
          renderItem={renderTransaction}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={!isLoading ? renderEmpty : null}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              colors={['#0ea5e9']}
            />
          }
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    minWidth: 80,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  summaryCard: {
    padding: 16,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  summaryCount: {
    fontSize: 12,
    color: '#9ca3af',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  transactionCard: {
    marginBottom: 12,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  transactionInfo: {
    flex: 1,
    marginRight: 12,
  },
  transactionDescription: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  transactionMerchant: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  transferBadge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  transferText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1e40af',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    color: '#4b5563',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  transactionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyButton: {
    minWidth: 200,
  },
});

