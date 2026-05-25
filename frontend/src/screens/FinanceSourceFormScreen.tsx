import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Modal, TouchableOpacity, FlatList, Platform } from 'react-native';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Screen, Card, Button, Input } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as financeSourcesApi from '@/api/financeSources';
import * as ratesApi from '@/api/rates';
import type { FinanceSource, FinanceSourceCreate } from '@/types/api';

interface FinanceSourceFormScreenProps {
  source?: FinanceSource;
  onSuccess: () => void;
  onCancel: () => void;
}

const SOURCE_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment', 'other'];

export function FinanceSourceFormScreen({ source, onSuccess, onCancel }: FinanceSourceFormScreenProps) {
  const queryClient = useQueryClient();
  const isEditing = !!source;

  const [name, setName] = useState(source?.name || '');
  const [type, setType] = useState(source?.type || 'checking');
  const [currency, setCurrency] = useState(source?.default_currency || 'USD');
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [currencyPickerVisible, setCurrencyPickerVisible] = useState(false);

  // Fetch supported currencies from backend (per D-07)
  const { data: currencyData } = useQuery({
    queryKey: [QUERY_KEYS.CURRENCIES],
    queryFn: () => ratesApi.getCurrencies(),
    staleTime: Infinity,
  });

  const currencies = currencyData
    ? Object.keys(currencyData.currencies).sort()
    : ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: FinanceSourceCreate) => financeSourcesApi.createFinanceSource(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.FINANCE_SOURCES] });
      Alert.alert('Success', 'Finance source created successfully!');
      onSuccess();
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to create finance source');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string } }) =>
      financeSourcesApi.updateFinanceSource(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.FINANCE_SOURCES] });
      Alert.alert('Success', 'Finance source updated successfully!');
      onSuccess();
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to update finance source');
    },
  });

  const validate = () => {
    const newErrors: { name?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (name.length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    } else if (name.length > 100) {
      newErrors.name = 'Name must be less than 100 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) {
      return;
    }

    if (isEditing && source) {
      updateMutation.mutate({
        id: source.id,
        data: { name: name.trim() },
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        type,
        default_currency: currency,
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
            {isEditing ? 'Edit Finance Source' : 'Add Finance Source'}
          </Text>
          <Text style={styles.subtitle}>
            {isEditing
              ? 'Update your finance source details'
              : 'Add a new account or payment method'}
          </Text>
        </View>

        <Card variant="elevated">
          {/* Name Input */}
          <Input
            label="Name *"
            placeholder="e.g., Chase Checking, Amex Credit"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            error={errors.name}
            hint="Give your finance source a recognizable name"
          />

          {/* Type Selection (only for new sources) */}
          {!isEditing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Type *</Text>
              <Text style={styles.sectionHint}>Select the type of finance source</Text>
              <View style={styles.optionsGrid}>
                {SOURCE_TYPES.map((t) => (
                  <Button
                    key={t}
                    title={t.charAt(0).toUpperCase() + t.slice(1)}
                    variant={type === t ? 'primary' : 'secondary'}
                    size="small"
                    onPress={() => setType(t)}
                    style={styles.optionButton}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Currency Selection (only for new sources) */}
          {!isEditing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Currency *</Text>
              <Text style={styles.sectionHint}>Default currency for this source</Text>
              {Platform.OS === 'web' ? (
                /* Web: horizontal scrollable button row (per D-08) */
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.currencyList}>
                    {currencies.map((c) => (
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
              ) : (
                /* Native: TouchableOpacity opens FlatList modal (per D-09) */
                <>
                  <TouchableOpacity
                    style={styles.currencyTrigger}
                    onPress={() => setCurrencyPickerVisible(true)}
                  >
                    <Text style={styles.currencyTriggerText}>{currency}</Text>
                  </TouchableOpacity>

                  <Modal
                    visible={currencyPickerVisible}
                    animationType="slide"
                    onRequestClose={() => setCurrencyPickerVisible(false)}
                  >
                    <View style={styles.modalContainer}>
                      {/* Modal header */}
                      <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Select Currency</Text>
                        <TouchableOpacity
                          onPress={() => setCurrencyPickerVisible(false)}
                          style={styles.modalCloseButton}
                        >
                          <Text style={styles.modalClose}>Close</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Currency list */}
                      <FlatList
                        data={currencies}
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
                </>
              )}
            </View>
          )}

          {/* Info Note for Editing */}
          {isEditing && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ℹ️ Type and currency cannot be changed after creation
              </Text>
            </View>
          )}

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
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    minWidth: 100,
  },
  currencyList: {
    flexDirection: 'row',
    gap: 8,
  },
  currencyButton: {
    minWidth: 60,
  },
  infoBox: {
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 12,
    color: '#1e40af',
    lineHeight: 18,
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

