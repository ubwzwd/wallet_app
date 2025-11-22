import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Input } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as transactionsApi from '@/api/transactions';
import * as financeSourcesApi from '@/api/financeSources';
import type { Transaction, TransactionCreate } from '@/types/api';

interface TransactionFormScreenProps {
  transaction?: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

type TransactionType = 'expense' | 'income' | 'transfer';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];

export function TransactionFormScreen({ transaction, onSuccess, onCancel }: TransactionFormScreenProps) {
  const queryClient = useQueryClient();
  const isEditing = !!transaction;

  // Form state
  const [type, setType] = useState<TransactionType>('expense');
  const [sourceId, setSourceId] = useState(transaction?.source_id || '');
  const [amount, setAmount] = useState(transaction ? Math.abs(parseFloat(transaction.amount)).toString() : '');
  const [currency, setCurrency] = useState(transaction?.currency || 'USD');
  const [date, setDate] = useState(transaction?.occurred_at || new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState(transaction?.description || '');
  const [merchant, setMerchant] = useState(transaction?.merchant || '');
  const [tagsInput, setTagsInput] = useState(transaction?.tags.join(', ') || '');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Fetch active finance sources
  const { data: sources } = useQuery({
    queryKey: [QUERY_KEYS.FINANCE_SOURCES, false],
    queryFn: () => financeSourcesApi.getFinanceSources(false),
  });

  // Set default source
  useEffect(() => {
    if (!isEditing && sources && sources.length > 0 && !sourceId) {
      setSourceId(sources[0].id);
    }
  }, [sources, sourceId, isEditing]);

  // Determine transaction type from amount
  useEffect(() => {
    if (transaction) {
      const amt = parseFloat(transaction.amount);
      if (transaction.transfer_pair_id) {
        setType('transfer');
      } else if (amt >= 0) {
        setType('income');
      } else {
        setType('expense');
      }
    }
  }, [transaction]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: TransactionCreate) => transactionsApi.createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
      if (Platform.OS === 'web') {
        window.alert('Success\n\nTransaction created successfully!');
      }
      onSuccess();
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to create transaction';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      transactionsApi.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
      if (Platform.OS === 'web') {
        window.alert('Success\n\nTransaction updated successfully!');
      }
      onSuccess();
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to update transaction';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      }
    },
  });

  const validate = () => {
    const newErrors: { [key: string]: string } = {};

    if (!sourceId) {
      newErrors.sourceId = 'Finance source is required';
    }
    if (!amount || parseFloat(amount) <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }
    if (!date) {
      newErrors.date = 'Date is required';
    }
    if (type === 'transfer') {
      newErrors.type = 'Transfer transactions are not yet supported in this form';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) {
      return;
    }

    const numAmount = parseFloat(amount);
    const signedAmount = type === 'income' ? numAmount : -numAmount;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (isEditing && transaction) {
      updateMutation.mutate({
        id: transaction.id,
        data: {
          amount: signedAmount,
          currency: currency.toUpperCase(),
          occurred_at: date,
          description: description.trim() || undefined,
          merchant: merchant.trim() || undefined,
          tags,
        },
      });
    } else {
      createMutation.mutate({
        source_id: sourceId,
        amount: signedAmount,
        currency: currency.toUpperCase(),
        occurred_at: date,
        description: description.trim() || undefined,
        merchant: merchant.trim() || undefined,
        tags,
      });
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Screen>
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>
            {isEditing ? 'Edit Transaction' : 'Add Transaction'}
          </Text>
          <Text style={styles.subtitle}>
            {isEditing ? 'Update transaction details' : 'Record a new transaction'}
          </Text>
        </View>

        <Card variant="elevated">
          {/* Transaction Type (only for new transactions) */}
          {!isEditing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Type *</Text>
              <View style={styles.typeButtons}>
                <Button
                  title="💸 Expense"
                  variant={type === 'expense' ? 'primary' : 'secondary'}
                  onPress={() => setType('expense')}
                  style={styles.typeButton}
                  size="small"
                />
                <Button
                  title="💰 Income"
                  variant={type === 'income' ? 'primary' : 'secondary'}
                  onPress={() => setType('income')}
                  style={styles.typeButton}
                  size="small"
                />
                <Button
                  title="🔄 Transfer"
                  variant={type === 'transfer' ? 'primary' : 'secondary'}
                  onPress={() => setType('transfer')}
                  style={styles.typeButton}
                  size="small"
                  disabled
                />
              </View>
              {type === 'transfer' && (
                <Text style={styles.hint}>Transfer support coming soon</Text>
              )}
            </View>
          )}

          {/* Finance Source Selection */}
          {!isEditing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Finance Source *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.sourceList}>
                  {sources?.map((source) => (
                    <Button
                      key={source.id}
                      title={`${source.name}\n(${source.default_currency})`}
                      variant={sourceId === source.id ? 'primary' : 'secondary'}
                      onPress={() => setSourceId(source.id)}
                      style={styles.sourceButton}
                      size="small"
                    />
                  ))}
                </View>
              </ScrollView>
              {errors.sourceId && <Text style={styles.errorText}>{errors.sourceId}</Text>}
            </View>
          )}

          {/* Amount Input */}
          <Input
            label="Amount *"
            placeholder="0.00"
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              setErrors((prev) => ({ ...prev, amount: '' }));
            }}
            keyboardType="decimal-pad"
            error={errors.amount}
          />

          {/* Currency Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Currency *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.currencyList}>
                {CURRENCIES.map((c) => (
                  <Button
                    key={c}
                    title={c}
                    variant={currency === c ? 'primary' : 'secondary'}
                    size="small"
                    onPress={() => setCurrency(c)}
                    style={styles.currencyButton}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Date Input */}
          <Input
            label="Date *"
            placeholder="YYYY-MM-DD"
            value={date}
            onChangeText={(text) => {
              setDate(text);
              setErrors((prev) => ({ ...prev, date: '' }));
            }}
            error={errors.date}
            hint="Format: YYYY-MM-DD (e.g., 2025-01-15)"
          />

          {/* Description Input */}
          <Input
            label="Description"
            placeholder="e.g., Grocery shopping, Salary, etc."
            value={description}
            onChangeText={setDescription}
            hint="Optional: Add a description for this transaction"
          />

          {/* Merchant Input */}
          <Input
            label="Merchant"
            placeholder="e.g., Whole Foods, Amazon, etc."
            value={merchant}
            onChangeText={setMerchant}
            hint="Optional: Where did this transaction occur?"
          />

          {/* Tags Input */}
          <Input
            label="Tags"
            placeholder="e.g., food, groceries, essentials"
            value={tagsInput}
            onChangeText={setTagsInput}
            hint="Optional: Comma-separated tags for categorization"
          />

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              disabled={isLoading}
              style={styles.actionButton}
            />
            <Button
              title={isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading || type === 'transfer'}
              style={styles.actionButton}
            />
          </View>
        </Card>
      </ScrollView>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  typeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    flex: 1,
  },
  sourceList: {
    flexDirection: 'row',
    gap: 8,
  },
  sourceButton: {
    minWidth: 120,
  },
  currencyList: {
    flexDirection: 'row',
    gap: 8,
  },
  currencyButton: {
    minWidth: 60,
  },
  hint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
  },
});

