import React, { forwardRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { MapPin, Tag, Calendar, ShoppingBag, Wallet } from 'lucide-react-native';
import { useInfiniteList } from '../hooks/queries/useInfiniteList';
import { fetchAvailablePropertiesPage } from '../hooks/queries/fetchers';
import { LIST_PERF, PAGE_SIZE } from '../lib/queryClient';
import { depositAmountFromRent } from '../lib/depositPayments';

export interface BrowseProperty {
  id: string;
  title: string;
  description: string;
  type: 'rental' | 'sale';
  category: 'residential' | 'commercial' | 'land';
  price: number;
  location: string;
  status: 'available' | 'reserved' | 'rented' | 'sold';
  image_urls: string[];
}

type BrowseCategory = 'Residential' | 'Commercial' | 'Land';

const ALL_CATEGORIES: BrowseCategory[] = ['Residential', 'Commercial', 'Land'];

function formatPrice(price: number, type: string) {
  const formatted = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(price);
  return type === 'rental' ? `${formatted}/month` : formatted;
}

type PropertyBrowseListProps = {
  onAction: (property: BrowseProperty) => void;
  /** Optional secondary action (e.g. Request viewing on sale listings). */
  onSecondaryAction?: (property: BrowseProperty) => void;
  /** Optional override for the card CTA label. Defaults by property type. */
  actionLabel?: (property: BrowseProperty) => string;
  /** Optional override for secondary CTA label. */
  secondaryActionLabel?: (property: BrowseProperty) => string;
  /** Renders above category tabs; scrolls with the list. */
  ListHeaderComponent?: React.ReactElement | null;
  /** Hide category filter tabs (e.g. compact embeds). */
  hideCategoryTabs?: boolean;
  /** Limit visible tabs and fetch results to these categories (e.g. client browse). */
  allowedCategories?: BrowseCategory[];
};

const PropertyBrowseList = forwardRef<FlatList<BrowseProperty>, PropertyBrowseListProps>(
  function PropertyBrowseList(
    {
      onAction,
      onSecondaryAction,
      actionLabel,
      secondaryActionLabel,
      ListHeaderComponent,
      hideCategoryTabs = false,
      allowedCategories,
    },
    ref
  ) {
    const categoryTabs = [
      'All',
      ...(allowedCategories && allowedCategories.length > 0
        ? allowedCategories
        : ALL_CATEGORIES),
    ];
    const allowedDbCategories =
      allowedCategories && allowedCategories.length > 0
        ? allowedCategories.map((c) => c.toLowerCase())
        : undefined;

    const [selectedCategory, setSelectedCategory] = useState('All');

    const {
      items: properties,
      loading,
      refreshing,
      loadingMore,
      error,
      refresh,
      loadMore,
    } = useInfiniteList<BrowseProperty>(
      [
        'properties',
        'available',
        selectedCategory,
        allowedDbCategories?.join(',') ?? 'all',
      ],
      (page) =>
        fetchAvailablePropertiesPage(selectedCategory, page, allowedDbCategories),
      PAGE_SIZE.properties
    );

    useEffect(() => {
      if (error) {
        console.error('Fetch properties error:', error);
        Alert.alert('Error', 'Failed to load property listings.');
      }
    }, [error]);

    const renderHeader = () => (
      <View>
        {ListHeaderComponent}
        {!hideCategoryTabs ? (
          <View style={styles.tabContainer}>
            {categoryTabs.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.tabBtn, selectedCategory === cat && styles.tabBtnActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.tabText, selectedCategory === cat && styles.tabTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {loading && properties.length === 0 ? (
          <View style={styles.loadingInline}>
            <ActivityIndicator size="large" color="#38BDF8" />
          </View>
        ) : null}
      </View>
    );

    return (
      <View style={styles.flex}>
        <FlatList
          ref={ref}
          data={properties}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image
                source={{
                  uri:
                    item.image_urls?.[0] ||
                    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
                }}
                style={styles.cardImage}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              <View style={styles.cardBody}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeText}>{item.type.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <MapPin size={16} color="#38BDF8" style={styles.infoIcon} />
                  <Text style={styles.infoText}>{item.location}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Tag size={16} color="#38BDF8" style={styles.infoIcon} />
                  <Text style={styles.infoText}>{item.category.toUpperCase()}</Text>
                </View>

                <Text style={styles.price}>{formatPrice(item.price, item.type)}</Text>
                {item.type === 'rental' ? (
                  <Text style={styles.depositNote}>
                    Deposit:{' '}
                    {formatPrice(depositAmountFromRent(item.price), 'sale')} (½ month,
                    refundable)
                  </Text>
                ) : null}
                <Text style={styles.description} numberOfLines={2}>
                  {item.description}
                </Text>
                {item.type === 'sale' ? (
                  <Text style={styles.saleNote}>
                    For sale — submit payment proof in-app. IBSA staff verifies, then the
                    listing is marked sold. You can also request a viewing first.
                  </Text>
                ) : (
                  <Text style={styles.saleNote}>
                    Pay a security deposit (½ month rent) to reserve. Full rent is still due
                    when you occupy. Deposit is refunded on exit if there is no damage.
                  </Text>
                )}

                <View style={styles.cardFooter}>
                  <TouchableOpacity style={styles.bookBtn} onPress={() => onAction(item)}>
                    {item.type === 'sale' ? (
                      <ShoppingBag size={16} color="#0F172A" style={styles.btnIcon} />
                    ) : (
                      <Wallet size={16} color="#0F172A" style={styles.btnIcon} />
                    )}
                    <Text style={styles.bookBtnText}>
                      {actionLabel
                        ? actionLabel(item)
                        : item.type === 'sale'
                          ? 'Buy Property'
                          : 'Pay Deposit'}
                    </Text>
                  </TouchableOpacity>
                  {onSecondaryAction ? (
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => onSecondaryAction(item)}
                    >
                      <Calendar size={14} color="#38BDF8" style={styles.btnIcon} />
                      <Text style={styles.secondaryBtnText}>
                        {secondaryActionLabel
                          ? secondaryActionLabel(item)
                          : item.type === 'sale'
                            ? 'Request Viewing'
                            : 'Book Viewing'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </View>
          )}
          contentContainerStyle={[
            styles.listContainer,
            properties.length === 0 && styles.emptyList,
          ]}
          onRefresh={refresh}
          refreshing={refreshing}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          initialNumToRender={LIST_PERF.initialNumToRender}
          windowSize={LIST_PERF.windowSize}
          maxToRenderPerBatch={LIST_PERF.maxToRenderPerBatch}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color="#38BDF8" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading && properties.length === 0 ? null : (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>
                  No available properties found in this category.
                </Text>
              </View>
            )
          }
        />
      </View>
    );
  }
);

export default PropertyBrowseList;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  tabText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
  tabTextActive: {
    color: '#38BDF8',
  },
  loadingInline: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  listContainer: {
    paddingBottom: 40,
    paddingTop: 8,
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    marginTop: 4,
    marginHorizontal: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardImage: {
    width: '100%',
    height: 180,
  },
  cardBody: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  typeBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  typeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  infoIcon: {
    marginRight: 6,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  price: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginVertical: 10,
  },
  description: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  saleNote: {
    color: '#EAB308',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  depositNote: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 4,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
    gap: 10,
  },
  bookBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  secondaryBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#38BDF8',
    backgroundColor: 'transparent',
  },
  secondaryBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 14,
  },
  btnIcon: {
    marginRight: 8,
  },
  bookBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 15,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
  },
});
