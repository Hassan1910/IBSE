import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import { ShoppingBag, ExternalLink, FileText } from 'lucide-react-native';
import { queryKeys } from '../../hooks/queries/keys';
import { LIST_PERF } from '../../lib/queryClient';
import {
  fetchBuyerPurchases,
  type PropertyPurchase,
  type PurchaseStatus,
} from '../../lib/purchases';
import { createSignedStorageUrl, openStorageUrl } from '../../lib/storage';

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(price);
}

function statusColor(status: PurchaseStatus) {
  switch (status) {
    case 'verified':
      return '#10B981';
    case 'pending':
      return '#EAB308';
    case 'failed':
      return '#EF4444';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export default function MyPurchasesScreen() {
  const { user } = useUser();
  const router = useRouter();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();
  const userId = user?.id || '';
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const purchasesQuery = useQuery({
    queryKey: queryKeys.clientPurchases(userId),
    queryFn: () => fetchBuyerPurchases(userId),
    enabled: !!userId,
  });

  const purchases = purchasesQuery.data || [];
  const loading = purchasesQuery.isLoading && !purchasesQuery.data;
  const refreshing = purchasesQuery.isRefetching && !purchasesQuery.isLoading;

  useEffect(() => {
    if (purchasesQuery.isError) {
      console.error('Fetch purchases error:', purchasesQuery.error);
      Alert.alert('Error', 'Failed to load your purchases.');
    }
  }, [purchasesQuery.isError, purchasesQuery.error]);

  useEffect(() => {
    if (!focusId || loading) return;
    if (purchases.some((p) => p.id === focusId)) {
      setHighlightedId(focusId);
      router.setParams({ id: undefined });
      const timer = setTimeout(() => setHighlightedId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [focusId, loading, purchases, router]);

  const openUrl = async (url: string) => {
    try {
      await openStorageUrl(url);
    } catch {
      Alert.alert('Error', 'Could not open the file.');
    }
  };

  const openPurchaseDoc = async (pathOrUrl: string) => {
    try {
      const signed = await createSignedStorageUrl('purchase-documents', pathOrUrl);
      await Linking.openURL(signed);
    } catch {
      Alert.alert('Error', 'Could not open the file.');
    }
  };

  const renderItem = ({ item }: { item: PropertyPurchase }) => {
    const docs = item.purchase_documents || [];
    return (
      <View style={[styles.card, highlightedId === item.id && styles.cardHighlight]}>
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <ShoppingBag size={18} color="#38BDF8" />
            <Text style={styles.title}>{item.properties?.title || 'Property'}</Text>
          </View>
          <View style={[styles.badge, { borderColor: statusColor(item.status) }]}>
            <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>{item.properties?.location || '—'}</Text>
        <Text style={styles.amount}>{formatPrice(Number(item.amount))}</Text>
        <Text style={styles.meta}>
          {item.payment_method.toUpperCase()} · Ref {item.reference_code}
        </Text>
        <Text style={styles.meta}>
          Submitted {new Date(item.created_at).toLocaleString()}
        </Text>

        {item.notes ? <Text style={styles.notes}>Note: {item.notes}</Text> : null}

        {item.proof_url ? (
          <TouchableOpacity style={styles.linkRow} onPress={() => openUrl(item.proof_url!)}>
            <ExternalLink size={14} color="#38BDF8" />
            <Text style={styles.linkText}>View payment proof</Text>
          </TouchableOpacity>
        ) : null}

        {docs.length > 0 ? (
          <View style={styles.docsBlock}>
            <Text style={styles.docsTitle}>Sale documents</Text>
            {docs.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.linkRow}
                onPress={() => openPurchaseDoc(doc.file_url)}
              >
                <FileText size={14} color="#38BDF8" />
                <Text style={styles.linkText}>
                  {doc.title} ({doc.doc_type})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {item.status === 'failed' ? (
          <Text style={styles.retryHint}>
            This submission was rejected. You can submit a new purchase from Explore.
          </Text>
        ) : null}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={purchases}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          purchases.length === 0 && styles.emptyList,
        ]}
        refreshing={refreshing}
        onRefresh={() => purchasesQuery.refetch()}
        initialNumToRender={LIST_PERF.initialNumToRender}
        windowSize={LIST_PERF.windowSize}
        maxToRenderPerBatch={LIST_PERF.maxToRenderPerBatch}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              No purchase submissions yet. Open Explore to buy a sale listing.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyList: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#94A3B8',
    textAlign: 'center',
    fontSize: 15,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    marginBottom: 14,
  },
  cardHighlight: {
    borderColor: '#38BDF8',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  title: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 16,
    flex: 1,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 4,
  },
  amount: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 6,
  },
  notes: {
    color: '#EAB308',
    fontSize: 13,
    marginTop: 6,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  linkText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  docsBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
  },
  docsTitle: {
    color: '#F8FAFC',
    fontWeight: '600',
    marginBottom: 4,
  },
  retryHint: {
    marginTop: 12,
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
  },
});
