import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Input } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as financeSourcesApi from '@/api/financeSources';
import type { FinanceSource, FinanceSourceCreate } from '@/types/api';

interface FinanceSourceFormScreenProps {
  source?: FinanceSource;
  onSuccess: () => void;
  onCancel: () => void;
}

const SOURCE_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment', 'other'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];

export function FinanceSourceFormScreen({ source, onSuccess, onCancel }: FinanceSourceFormScreenProps) {
  const queryClient = useQueryClient();
  const isEditing = !!source;

  const [name, setName] = useState(source?.name || '');
  const [type, setType] = useState(source?.type || 'checking');
  const [currency, setCurrency] = useState(source?.default_currency || 'USD');
  const [errors, setErrors] = useState<{ name?: string }>({});

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
});

