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
import { MapPin, Tag, Calendar } from 'lucide-react-native';
import { useInfiniteList } from '../hooks/queries/useInfiniteList';
import { fetchAvailablePropertiesPage } from '../hooks/queries/fetchers';
import { LIST_PERF, PAGE_SIZE } from '../lib/queryClient';

export interface BrowseProperty {
  id: string;
  title: string;
  description: string;
  type: 'rental' | 'sale';
  category: 'residential' | 'commercial' | 'land';
  price: number;
  location: string;
  status: 'available' | 'rented' | 'sold';
  image_urls: string[];
}

const CATEGORIES = ['All', 'Residential', 'Commercial', 'Land'];

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
  /** Optional override for the card CTA label. Defaults by property type. */
  actionLabel?: (property: BrowseProperty) => string;
  /** Renders above category tabs; scrolls with the list. */
  ListHeaderComponent?: React.ReactElement | null;
  /** Hide category filter tabs (e.g. compact embeds). */
  hideCategoryTabs?: boolean;
};

const PropertyBrowseList = forwardRef<FlatList<BrowseProperty>, PropertyBrowseListProps>(
  function PropertyBrowseList(
    { onAction, actionLabel, ListHeaderComponent, hideCategoryTabs = false },
    ref
  ) {
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
      ['properties', 'available', selectedCategory],
      (page) => fetchAvailablePropertiesPage(selectedCategory, page),
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
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.tabBtn, selectedCategory === cat && styles.tabBtnActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text
                  style={[styles.tabText, selectedCategory === cat && styles.tabTextActive]}
                >
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
          data={loading && properties.length === 0 ? [] : properties}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image
                source={{
                  uri:
                    item.image_urls?.[0] ||
                    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80',
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
                <Text style={styles.description} numberOfLines={2}>
                  {item.description}
                </Text>
                {item.type === 'sale' ? (
                  <Text style={styles.saleNote}>
                    For sale — request a viewing. Purchase is completed offline with IBSA
                    staff (no in-app checkout).
                  </Text>
                ) : null}

                <View style={styles.cardFooter}>
                  <TouchableOpacity style={styles.bookBtn} onPress={() => onAction(item)}>
                    <Calendar size={16} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.bookBtnText}>
                      {actionLabel
                        ? actionLabel(item)
                        : item.type === 'sale'
                          ? 'Request Viewing'
                          : 'Book Viewing'}
                    </Text>
                  </TouchableOpacity>
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
    paddingVertical: 48,
    alignItems: 'center',
  },
  loadingMore: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  listContainer: {
    paddingBottom: 40,
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
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  bookBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
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
