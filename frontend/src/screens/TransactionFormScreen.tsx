import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Platform, Modal, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Input } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as transactionsApi from '@/api/transactions';
import * as financeSourcesApi from '@/api/financeSources';
import * as ratesApi from '@/api/rates';
import type { Transaction, TransactionCreate } from '@/types/api';

interface TransactionFormScreenProps {
  transaction?: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

type TransactionType = 'expense' | 'income' | 'transfer';

export function TransactionFormScreen({ transaction, onSuccess, onCancel }: TransactionFormScreenProps) {
  const queryClient = useQueryClient();
  const isEditing = !!transaction;

  // Form state
  const [type, setType] = useState<TransactionType>('expense');
  const [sourceId, setSourceId] = useState(transaction?.source_id || '');
  const [amount, setAmount] = useState(transaction ? Math.abs(Number(transaction.amount)).toString() : '');
  const [currency, setCurrency] = useState(transaction?.currency || 'USD');
  const [date, setDate] = useState(transaction?.occurred_at || new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState(transaction?.description || '');
  const [merchant, setMerchant] = useState(transaction?.merchant || '');
  const [tagsInput, setTagsInput] = useState(transaction?.tags.join(', ') || '');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [currencyPickerVisible, setCurrencyPickerVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // Transfer wizard state
  const [step, setStep] = useState<1 | 2>(1);
  const [destinationSourceId, setDestinationSourceId] = useState('');
  const [destPickerVisible, setDestPickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch active finance sources
  const { data: sources } = useQuery({
    queryKey: [QUERY_KEYS.FINANCE_SOURCES, false],
    queryFn: () => financeSourcesApi.getFinanceSources(false),
  });

  // Fetch supported currencies from backend (per D-07)
  const { data: currencyData } = useQuery({
    queryKey: [QUERY_KEYS.CURRENCIES],
    queryFn: () => ratesApi.getCurrencies(),
    staleTime: Infinity, // Currencies rarely change
  });

  // Derive sorted currency list; fall back to 6-item hardcoded list while loading (per D-10)
  const allCurrencies = currencyData
    ? Object.keys(currencyData.currencies).sort()
    : ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];

  const filteredCurrencies = currencySearch
    ? allCurrencies.filter(
        (c) =>
          c.toLowerCase().includes(currencySearch.toLowerCase()) ||
          (currencyData?.currencies[c]?.toLowerCase() || '').includes(currencySearch.toLowerCase())
      )
    : allCurrencies;

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

  // Reset transfer wizard state when type changes
  useEffect(() => {
    if (type !== 'transfer') {
      setStep(1);
      setDestinationSourceId('');
    }
  }, [type]);

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
    const parsedAmount = Number(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = isNaN(parsedAmount) ? 'Amount must be a valid number' : 'Amount must be greater than 0';
    }
    if (!date) {
      newErrors.date = 'Date is required';
    }
    if (type === 'transfer' && !isEditing) {
      if (!destinationSourceId) {
        newErrors.destinationSourceId = 'Destination source is required';
      }
      if (destinationSourceId === sourceId) {
        newErrors.destinationSourceId = 'Destination must differ from source';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle sequential transfer creation with rollback on partial failure (D-06, D-07, D-08, D-09)
  const handleTransferSubmit = async () => {
    if (!validate()) return;

    const pairId = crypto.randomUUID();
    const absAmount = Math.abs(Number(amount));
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const commonFields = {
      currency: currency.toUpperCase(),
      occurred_at: date,
      description: description.trim() || undefined,
      merchant: merchant.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      transfer_pair_id: pairId,
    };

    setIsSubmitting(true);

    let firstLeg: Transaction;
    try {
      firstLeg = await transactionsApi.createTransaction({
        source_id: sourceId,
        amount: -absAmount,
        ...commonFields,
      });
    } catch (err: any) {
      setIsSubmitting(false);
      const errorMessage = err.message || 'Failed to create transfer';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      } else {
        Alert.alert('Error', errorMessage);
      }
      return;
    }

    try {
      await transactionsApi.createTransaction({
        source_id: destinationSourceId,
        amount: absAmount,
        ...commonFields,
      });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.FINANCE_SOURCES, false] });
      setIsSubmitting(false);
      if (Platform.OS === 'web') {
        window.alert('Success\n\nTransfer created successfully!');
      } else {
        Alert.alert('Success', 'Transfer created successfully!');
      }
      onSuccess();
    } catch (secondErr: any) {
      // Second POST failed — attempt rollback of first leg (D-08)
      try {
        await transactionsApi.deleteTransaction(firstLeg.id);
      } catch {
        // Rollback also failed — show partial failure message
        setIsSubmitting(false);
        const partialMsg = 'Transfer partially created. One transaction may exist in your account \u2014 please check your transactions and delete manually if needed.';
        if (Platform.OS === 'web') {
          window.alert(`Transfer Error\n\n${partialMsg}`);
        } else {
          Alert.alert('Transfer Error', partialMsg);
        }
        return;
      }
      setIsSubmitting(false);
      const errorMessage = secondErr.message || 'Failed to create transfer';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      } else {
        Alert.alert('Error', errorMessage);
      }
    }
  };

  const handleTransferUpdate = async () => {
    if (!validate()) return;

    if (!transaction) return;

    const absAmount = Math.abs(Number(amount));
    const signedAmount = Number(transaction.amount) < 0 ? -absAmount : absAmount;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);

    setIsSubmitting(true);

    try {
      // Update current leg
      await transactionsApi.updateTransaction(transaction.id, {
        amount: signedAmount,
        occurred_at: date,
        description: description.trim() || undefined,
        merchant: merchant.trim() || undefined,
        tags,
      });

      // Find paired leg from cache, fallback to fetch
      let allTransactions = queryClient.getQueryData<Transaction[]>([QUERY_KEYS.TRANSACTIONS]);
      if (!allTransactions) {
        allTransactions = await transactionsApi.getTransactions();
      }
      const pairedLeg = allTransactions?.find(
        t => t.transfer_pair_id === transaction.transfer_pair_id && t.id !== transaction.id
      );

      if (pairedLeg) {
        const pairedSignedAmount = Number(pairedLeg.amount) < 0 ? -absAmount : absAmount;
        await transactionsApi.updateTransaction(pairedLeg.id, {
          amount: pairedSignedAmount,
          occurred_at: date,
          description: description.trim() || undefined,
          merchant: merchant.trim() || undefined,
          tags,
        });
      }

      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
      setIsSubmitting(false);
      if (Platform.OS === 'web') {
        window.alert('Success\n\nTransfer updated successfully!');
      } else {
        Alert.alert('Success', 'Transfer updated successfully!');
      }
      onSuccess();
    } catch (err: any) {
      setIsSubmitting(false);
      const errorMessage = err.message || 'Failed to update transfer';
      if (Platform.OS === 'web') {
        window.alert(`Error\n\n${errorMessage}`);
      } else {
        Alert.alert('Error', errorMessage);
      }
    }
  };

  const handleSubmit = () => {
    // Route to transfer handler for new transfer transactions
    if (type === 'transfer' && !isEditing) {
      handleTransferSubmit();
      return;
    }

    // Route to transfer update handler for editing existing transfers
    if (type === 'transfer' && isEditing) {
      handleTransferUpdate();
      return;
    }

    if (!validate()) {
      return;
    }

    const numAmount = Number(amount);
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

  const isLoading = createMutation.isPending || updateMutation.isPending || isSubmitting;

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
                  disabled={!sources || sources.length <= 1}
                />
              </View>
              {(!sources || sources.length <= 1) && (
                <Text style={styles.hint}>Add another finance source to enable transfers.</Text>
              )}
            </View>
          )}

          {/* Transfer wizard: Step 1 — Select Accounts */}
          {type === 'transfer' && !isEditing && step === 1 && (
            <View>
              <Text style={styles.sectionLabel}>Step 1 of 2 — Select Accounts</Text>

              {/* FROM source picker */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>From *</Text>
                <View style={styles.pickerContainer}>
                  <select
                    value={sourceId}
                    onChange={(e: any) => setSourceId(e.target.value)}
                    style={styles.picker as any}
                  >
                    {sources?.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name} ({source.default_currency})
                      </option>
                    ))}
                  </select>
                </View>
                {errors.sourceId && <Text style={styles.errorText}>{errors.sourceId}</Text>}
              </View>

              {/* TO destination picker (D-03, D-04): web uses <select>, native uses Modal+FlatList */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>To *</Text>
                {Platform.OS === 'web' ? (
                  <View style={styles.pickerContainer}>
                    <select
                      value={destinationSourceId}
                      onChange={(e: any) => setDestinationSourceId(e.target.value)}
                      style={styles.picker as any}
                    >
                      <option value="">Select destination</option>
                      {sources?.filter(s => s.id !== sourceId).map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name} ({source.default_currency})
                        </option>
                      ))}
                    </select>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.currencyTrigger}
                      onPress={() => setDestPickerVisible(true)}
                    >
                      <Text style={styles.currencyTriggerText}>
                        {sources?.find(s => s.id === destinationSourceId)?.name || 'Select destination'}
                      </Text>
                    </TouchableOpacity>

                    <Modal
                      visible={destPickerVisible}
                      animationType="slide"
                      onRequestClose={() => setDestPickerVisible(false)}
                    >
                      <View style={styles.modalContainer}>
                        <View style={styles.modalHeader}>
                          <Text style={styles.modalTitle}>Select Destination</Text>
                          <TouchableOpacity
                            onPress={() => setDestPickerVisible(false)}
                            style={styles.modalCloseButton}
                          >
                            <Text style={styles.modalClose}>Close</Text>
                          </TouchableOpacity>
                        </View>
                        <FlatList
                          data={sources?.filter(s => s.id !== sourceId)}
                          keyExtractor={(item) => item.id}
                          renderItem={({ item }) => {
                            const isSelected = item.id === destinationSourceId;
                            return (
                              <TouchableOpacity
                                style={[styles.currencyItem, isSelected && styles.currencyItemSelected]}
                                onPress={() => {
                                  setDestinationSourceId(item.id);
                                  setDestPickerVisible(false);
                                }}
                              >
                                <Text style={[styles.currencyItemText, isSelected && styles.currencyItemTextSelected]}>
                                  <Text style={styles.currencyCode}>{item.name}</Text>
                                  {` (${item.default_currency})`}
                                </Text>
                              </TouchableOpacity>
                            );
                          }}
                          ItemSeparatorComponent={() => <View style={styles.currencyDivider} />}
                        />
                      </View>
                    </Modal>
                  </>
                )}
                {errors.destinationSourceId && <Text style={styles.errorText}>{errors.destinationSourceId}</Text>}
              </View>

              {/* Navigation: Cancel + Next (D-01) */}
              <View style={styles.actions}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={onCancel}
                  style={styles.actionButton}
                />
                <Button
                  title="Next →"
                  onPress={() => {
                    if (!sourceId) {
                      setErrors({ sourceId: 'Finance source is required' });
                      return;
                    }
                    if (!destinationSourceId) {
                      setErrors({ destinationSourceId: 'Destination source is required' });
                      return;
                    }
                    if (destinationSourceId === sourceId) {
                      setErrors({ destinationSourceId: 'Destination must differ from source' });
                      return;
                    }
                    setErrors({});
                    setStep(2);
                  }}
                  style={styles.actionButton}
                />
              </View>
            </View>
          )}

          {/* Transfer wizard: Step 2 — Enter Amount */}
          {type === 'transfer' && !isEditing && step === 2 && (
            <View>
              <Text style={styles.sectionLabel}>Step 2 of 2 — Enter Amount</Text>

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
                inputMode="decimal"
                error={errors.amount}
              />

              {/* Currency Selection */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Currency *</Text>
                <TouchableOpacity
                  style={styles.currencyTrigger}
                  onPress={() => setCurrencyPickerVisible(true)}
                >
                  <Text style={styles.currencyTriggerText}>{currency}</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' && <Text style={styles.hint}>Tap to search</Text>}
              </View>

              {/* Date Input */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Date *</Text>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setErrors((prev) => ({ ...prev, date: '' }));
                  }}
                  style={styles.dateInput as any}
                />
                {errors.date && <Text style={styles.errorText}>{errors.date}</Text>}
              </View>

              {/* Description Input */}
              <Input
                label="Description"
                placeholder="e.g., Monthly transfer, Reimbursement, etc."
                value={description}
                onChangeText={setDescription}
                hint="Optional: Add a description for this transfer"
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
                placeholder="e.g., transfer, savings, reimbursement"
                value={tagsInput}
                onChangeText={setTagsInput}
                hint="Optional: Comma-separated tags for categorization"
              />

              {/* Navigation: Back + Create Transfer (D-01) */}
              <View style={styles.actions}>
                <Button
                  title="← Back"
                  variant="secondary"
                  onPress={() => setStep(1)}
                  disabled={isLoading}
                  style={styles.actionButton}
                />
                <Button
                  title={isLoading ? 'Saving...' : 'Create Transfer'}
                  onPress={handleSubmit}
                  loading={isLoading}
                  disabled={isLoading}
                  style={styles.actionButton}
                />
              </View>
            </View>
          )}

          {/* Transfer edit mode: simplified form for editing existing transfers */}
          {isEditing && type === 'transfer' && (
            <View>
              {/* Read-only note per D-11 */}
              <Text style={styles.hint}>Source and currency cannot be changed on an existing transfer.</Text>

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
                inputMode="decimal"
                error={errors.amount}
              />

              {/* Date Input */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Date *</Text>
                <input
                  type="date"
                  value={date}
                  onChange={(e: any) => {
                    setDate(e.target.value);
                    setErrors((prev) => ({ ...prev, date: '' }));
                  }}
                  style={styles.dateInput as any}
                />
                {errors.date && <Text style={styles.errorText}>{errors.date}</Text>}
              </View>

              {/* Description */}
              <Input
                label="Description"
                placeholder="e.g., Grocery shopping, Salary, etc."
                value={description}
                onChangeText={setDescription}
                hint="Optional: Add a description for this transaction"
              />

              {/* Merchant */}
              <Input
                label="Merchant"
                placeholder="e.g., Whole Foods, Amazon, etc."
                value={merchant}
                onChangeText={setMerchant}
                hint="Optional: Where did this transaction occur?"
              />

              {/* Tags */}
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
                  title={isLoading ? 'Saving...' : 'Update Transfer'}
                  onPress={handleSubmit}
                  loading={isLoading}
                  disabled={isLoading}
                  style={styles.actionButton}
                />
              </View>
            </View>
          )}

          {/* Standard form fields: shown for expense/income only (not transfer) */}
          {type !== 'transfer' && (
            <>
              {/* Finance Source Selection */}
              {!isEditing && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Finance Source *</Text>
                  <View style={styles.pickerContainer}>
                    <select
                      value={sourceId}
                      onChange={(e) => setSourceId(e.target.value)}
                      style={styles.picker as any}
                    >
                      {sources?.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name} ({source.default_currency})
                        </option>
                      ))}
                    </select>
                  </View>
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
                inputMode="decimal"
                error={errors.amount}
              />

              {/* Currency Selection */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Currency *</Text>
                <TouchableOpacity
                  style={styles.currencyTrigger}
                  onPress={() => setCurrencyPickerVisible(true)}
                >
                  <Text style={styles.currencyTriggerText}>{currency}</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' && <Text style={styles.hint}>Tap to search</Text>}
              </View>

              {/* Date Input */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Date *</Text>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setErrors((prev) => ({ ...prev, date: '' }));
                  }}
                  style={styles.dateInput as any}
                />
                {errors.date && <Text style={styles.errorText}>{errors.date}</Text>}
              </View>

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
                  disabled={isLoading}
                  style={styles.actionButton}
                />
              </View>
            </>
          )}
        </Card>
      </ScrollView>

      {/* Currency picker modal (consistent with ProfileScreen) */}
      <Modal
        visible={currencyPickerVisible}
        animationType="slide"
        onRequestClose={() => {
          setCurrencyPickerVisible(false);
          setCurrencySearch('');
        }}
      >
        <View style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Currency</Text>
            <TouchableOpacity
              onPress={() => {
                setCurrencyPickerVisible(false);
                setCurrencySearch('');
              }}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <TextInput
            style={styles.searchInput}
            placeholder="Search currencies..."
            placeholderTextColor="#9ca3af"
            value={currencySearch}
            onChangeText={setCurrencySearch}
          />

          {/* Currency list */}
          <FlatList
            data={filteredCurrencies}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isSelected = item === currency;
              const fullName = currencyData?.currencies[item];
              return (
                <TouchableOpacity
                  style={[styles.currencyItem, isSelected && styles.currencyItemSelected]}
                  onPress={() => {
                    setCurrency(item);
                    setCurrencyPickerVisible(false);
                    setCurrencySearch('');
                  }}
                >
                  <Text style={[styles.currencyItemText, isSelected && styles.currencyItemTextSelected]}>
                    <Text style={styles.currencyCode}>{item}</Text>
                    {fullName ? ` - ${fullName}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.currencyDivider} />}
          />
        </View>
      </Modal>
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
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    width: '100%',
    padding: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  currencyList: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'nowrap',
    paddingVertical: 4,
  },
  currencyButton: {
    minWidth: 60,
    flexShrink: 0,
  },
  dateInput: {
    width: '100%',
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
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
  currencyTrigger: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    minHeight: 44,
  },
  modalCloseButton: {
    minHeight: 44,
    minWidth: 44,
    padding: 12,
    justifyContent: 'center',
  },
  currencyTriggerText: {
    fontSize: 16,
    color: '#1f2937',
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    height: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  modalClose: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0ea5e9',
  },
  searchInput: {
    margin: 12,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    color: '#1f2937',
  },
  currencyItem: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
  },
  currencyItemSelected: {
    backgroundColor: '#eff6ff',
  },
  currencyItemText: {
    fontSize: 16,
    color: '#1f2937',
  },
  currencyItemTextSelected: {
    color: '#0ea5e9',
  },
  currencyCode: {
    fontWeight: '600',
  },
  currencyDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
  },
});
