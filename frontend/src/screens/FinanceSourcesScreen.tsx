import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button } from '@/components';
import { QUERY_KEYS } from '@/constants/config';
import * as financeSourcesApi from '@/api/financeSources';
import type { FinanceSource } from '@/types/api';

interface FinanceSourcesScreenProps {
  onCreatePress: () => void;
  onEditPress: (source: FinanceSource) => void;
}

export function FinanceSourcesScreen({ onCreatePress, onEditPress }: FinanceSourcesScreenProps) {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);

  // Fetch finance sources
  const { data: sources, isLoading, refetch } = useQuery({
    queryKey: [QUERY_KEYS.FINANCE_SOURCES, includeArchived],
    queryFn: () => financeSourcesApi.getFinanceSources(includeArchived),
  });

  // Archive/Unarchive mutation
  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      financeSourcesApi.updateFinanceSource(id, { archived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.FINANCE_SOURCES] });
    },
  });

  const handleArchiveToggle = (source: FinanceSource) => {
    const action = source.archived ? 'unarchive' : 'archive';
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Finance Source`,
      `Are you sure you want to ${action} "${source.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          onPress: () => {
            archiveMutation.mutate({ id: source.id, archived: !source.archived });
          },
        },
      ]
    );
  };

  const renderFinanceSource = ({ item }: { item: FinanceSource }) => (
    <Card variant="outlined" style={styles.sourceCard}>
      <View style={styles.sourceHeader}>
        <View style={styles.sourceInfo}>
          <Text style={styles.sourceName}>{item.name}</Text>
          <View style={styles.sourceDetails}>
            <Text style={styles.sourceType}>{item.type.toUpperCase()}</Text>
            <Text style={styles.sourceCurrency}>{item.default_currency}</Text>
          </View>
        </View>
        {item.archived && (
          <View style={styles.archivedBadge}>
            <Text style={styles.archivedText}>Archived</Text>
          </View>
        )}
      </View>

      <View style={styles.sourceActions}>
        <Button
          title="Edit"
          variant="secondary"
          size="small"
          onPress={() => onEditPress(item)}
          style={styles.actionButton}
        />
        <Button
          title={item.archived ? 'Unarchive' : 'Archive'}
          variant="secondary"
          size="small"
          onPress={() => handleArchiveToggle(item)}
          style={styles.actionButton}
        />
      </View>
    </Card>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>💳</Text>
      <Text style={styles.emptyTitle}>No Finance Sources</Text>
      <Text style={styles.emptyText}>
        Add your first bank account, credit card, or other payment source to start tracking your finances.
      </Text>
      <Button
        title="Add Finance Source"
        onPress={onCreatePress}
        style={styles.emptyButton}
      />
    </View>
  );

  return (
    <Screen padding={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Finance Sources</Text>
          <Text style={styles.subtitle}>Manage your accounts and payment methods</Text>
        </View>

        {/* Filter Toggle */}
        <View style={styles.filterContainer}>
          <Button
            title={includeArchived ? 'Hide Archived' : 'Show Archived'}
            variant="secondary"
            size="small"
            onPress={() => setIncludeArchived(!includeArchived)}
          />
          <Button
            title="Add New"
            size="small"
            onPress={onCreatePress}
          />
        </View>

        {/* Finance Sources List */}
        <FlatList
          data={sources}
          renderItem={renderFinanceSource}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
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
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
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
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    gap: 12,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  sourceCard: {
    marginBottom: 12,
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sourceInfo: {
    flex: 1,
  },
  sourceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  sourceDetails: {
    flexDirection: 'row',
    gap: 12,
  },
  sourceType: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  sourceCurrency: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0ea5e9',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  archivedBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  archivedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  sourceActions: {
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

