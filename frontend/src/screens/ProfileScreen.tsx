import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  Platform,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen, Card, Button } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import { useAuth } from '@/store/AuthContext';
import { updateMe } from '@/api/auth';
import * as ratesApi from '@/api/rates';
import type { UserUpdate } from '@/types/api';

interface ProfileScreenProps {
  onBack: () => void;
}

export function ProfileScreen({ onBack }: ProfileScreenProps) {
  const { user, refreshUser } = useAuth();
  const [selectedCurrency, setSelectedCurrency] = useState<string>(user?.base_currency ?? 'USD');
  const [pickerVisible, setPickerVisible] = useState(false);

  // Fetch live currency list (T-03-07: staleTime: Infinity caches result)
  const { data: currencyData, isLoading: currenciesLoading } = useQuery({
    queryKey: [QUERY_KEYS.CURRENCIES],
    queryFn: () => ratesApi.getCurrencies(),
    staleTime: Infinity,
  });

  const currencies = currencyData
    ? Object.keys(currencyData.currencies).sort()
    : ['USD', 'EUR', 'GBP', 'CNY', 'SGD', 'HKD'];

  const mutation = useMutation({
    mutationFn: (payload: { base_currency: string }) => updateMe(payload as UserUpdate),
    onSuccess: async () => {
      try {
        await refreshUser();
      } catch (error) {
        // Refresh after update might fail due to transient 401.
        // The PATCH succeeded, so user data is updated on server.
        // Log the error but don't block UI from proceeding.
        console.warn('Refresh after update failed (transient?), proceeding anyway:', error);
      }

      const msg = 'Profile updated successfully!';
      if (Platform.OS === 'web') {
        window.alert('Success\n\n' + msg);
      } else {
        Alert.alert('Success', msg);
      }
      onBack();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? 'Failed to update profile. Please try again.';
      if (Platform.OS === 'web') {
        window.alert('Error\n\n' + msg);
      } else {
        Alert.alert('Error', msg);
      }
    },
  });

  const handleSave = () => {
    if (selectedCurrency !== user?.base_currency) {
      mutation.mutate({ base_currency: selectedCurrency });
    } else {
      onBack();
    }
  };

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString()
    : '—';

  return (
    <Screen>
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Edit Profile</Text>
        </View>

        {/* Read-only account information card (T-03-06: user's own data only) */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>Account Information</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email:</Text>
            <Text style={styles.infoValue}>{user?.email}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Member since:</Text>
            <Text style={styles.infoValue}>{memberSince}</Text>
          </View>
        </Card>

        {/* Currency settings card */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.cardTitle}>Preferences</Text>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Base Currency</Text>
            <TouchableOpacity
              style={styles.currencyTrigger}
              onPress={() => setPickerVisible(true)}
              disabled={currenciesLoading}
            >
              <Text style={styles.currencyTriggerText}>{selectedCurrency}</Text>
            </TouchableOpacity>
            <Text style={styles.sectionHint}>Used as the default currency for conversions</Text>
          </View>
        </Card>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Button
            title={mutation.isPending ? 'Saving...' : 'Save Changes'}
            onPress={handleSave}
            disabled={mutation.isPending || currenciesLoading}
            loading={mutation.isPending}
            style={styles.actionButton}
          />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={onBack}
            style={styles.actionButton}
          />
        </View>
      </ScrollView>

      {/* Currency picker modal (D-03) — pattern from FinanceSourceFormScreen */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Currency</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Currency list */}
          <FlatList
            data={currencies}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isSelected = item === selectedCurrency;
              const fullName = currencyData?.currencies[item];
              return (
                <TouchableOpacity
                  style={[styles.currencyItem, isSelected && styles.currencyItemSelected]}
                  onPress={() => {
                    setSelectedCurrency(item);
                    setPickerVisible(false);
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
  backButton: {
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#0ea5e9',
    fontWeight: '600',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
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
    flexShrink: 1,
    textAlign: 'right',
  },
  section: {
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 6,
  },
  actions: {
    gap: 12,
    marginTop: 8,
    marginBottom: 24,
  },
  actionButton: {
    width: '100%',
  },
  // Currency picker trigger
  currencyTrigger: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  currencyTriggerText: {
    fontSize: 16,
    color: '#1f2937',
    fontWeight: '600',
  },
  // Modal styles (copied from FinanceSourceFormScreen)
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
