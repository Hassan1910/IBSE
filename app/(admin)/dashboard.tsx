import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Linking,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useRole } from '../../hooks/useRole';
import { notifyUser } from '../../lib/notifications';
import { countPendingAccounts } from '../../lib/accountApproval';
import { generateAndAttachReceipt } from '../../lib/receipts';
import {
  completePurchase,
  rejectPurchase,
  uploadPurchaseDocument,
  type PendingPurchaseQueueItem,
  type PurchaseDocType,
} from '../../lib/purchases';
import {
  completeDepositPayment,
  rejectDepositPayment,
  releaseDepositPayment,
  type PendingDepositQueueItem,
} from '../../lib/depositPayments';
import { pickDocument, createSignedStorageUrl, openStorageUrl } from '../../lib/storage';
import MaterialsUsedModal from '../../components/MaterialsUsedModal';
import NotificationBell from '../../components/NotificationBell';
import StatCard from '../../components/admin/StatCard';
import SegmentedTabs from '../../components/admin/SegmentedTabs';
import QueueCard, {
  QueueCardDivider,
  QueueCardInfoRow,
  QueueCardActionButton,
} from '../../components/admin/QueueCard';
import DashboardSkeleton from '../../components/admin/DashboardSkeleton';
import { adminTheme } from '../../constants/adminTheme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAdminDashboardQueues,
  useAdminDashboardStats,
} from '../../hooks/queries/useDashboard';
import { queryKeys } from '../../hooks/queries/keys';
import { LIST_PERF } from '../../lib/queryClient';
import { useAudit } from '../../hooks/useAudit';
import {
  CreditCard,
  User,
  X,
  ShieldAlert,
  Calendar,
  Wrench,
  MessageSquare,
  Clock,
  CheckCircle,
  CheckCheck,
  FileText,
  Package,
  Wallet,
  FileText as LeaseIcon,
  FilePlus,
  ShoppingBag,
  ExternalLink,
  Users,
} from 'lucide-react-native';
import ConvertBookingToLeaseModal, {
  type LeaseConversionSource,
} from '../../components/ConvertBookingToLeaseModal';
import StorageImage from '../../components/StorageImage';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getPriorityColors(p: string) {
  switch (p) {
    case 'high':
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        borderColor: adminTheme.colors.danger,
        textColor: adminTheme.colors.danger,
      };
    case 'medium':
      return {
        backgroundColor: 'rgba(234, 179, 8, 0.15)',
        borderColor: adminTheme.colors.warning,
        textColor: adminTheme.colors.warning,
      };
    default:
      return {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderColor: adminTheme.colors.success,
        textColor: adminTheme.colors.success,
      };
  }
}

function getFeedbackBadgeColors(type: string) {
  switch (type) {
    case 'complaint':
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        borderColor: adminTheme.colors.danger,
        textColor: adminTheme.colors.danger,
      };
    case 'suggestion':
      return {
        backgroundColor: adminTheme.colors.accentMuted,
        borderColor: adminTheme.colors.accent,
        textColor: adminTheme.colors.accent,
      };
    default:
      return {
        backgroundColor: 'rgba(234, 179, 8, 0.15)',
        borderColor: adminTheme.colors.warning,
        textColor: adminTheme.colors.warning,
      };
  }
}

interface Payment {
  id: string;
  payer_id: string;
  amount: number;
  payment_method: string;
  reference_code: string;
  payment_date: string;
  status: 'pending' | 'verified' | 'failed';
  proof_url?: string | null;
  receipt_url?: string | null;
  profiles: {
    full_name: string;
    email: string;
  };
  leases: {
    properties: {
      title: string;
    };
  } | null;
}

interface Booking {
  id: string;
  client_id: string;
  property_id: string;
  booking_date: string;
  type: 'viewing';
  status: 'pending' | 'approved' | 'declined' | 'completed' | 'cancelled';
  notes: string;
  properties: {
    title: string;
    location: string;
    type?: 'rental' | 'sale';
    owner_id?: string | null;
    price?: number;
  };
  profiles: {
    full_name: string;
    email: string;
    phone: string;
  };
}

interface MaintenanceRequest {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'resolved';
  created_at: string;
  image_urls: string[] | null;
  properties: {
    title: string;
  };
  profiles: {
    full_name: string;
  };
}

interface Feedback {
  id: string;
  type: 'complaint' | 'suggestion' | 'inquiry';
  message: string;
  created_at: string;
  profiles: {
    full_name: string;
    email: string;
  };
}

type DashboardTab = 'payments' | 'purchases' | 'deposits' | 'bookings' | 'maintenance' | 'feedback';
type DashboardSection = 'money' | 'ops';

const MONEY_TABS: DashboardTab[] = ['payments', 'purchases', 'deposits'];
const OPS_TABS: DashboardTab[] = ['bookings', 'maintenance', 'feedback'];

function sectionForTab(tab: DashboardTab): DashboardSection {
  return MONEY_TABS.includes(tab) ? 'money' : 'ops';
}

function isDepositReadyForLease(item: PendingDepositQueueItem): boolean {
  return item.status === 'verified' && !item.lease_id;
}

export default function AdminDashboard() {
  const { user } = useUser();
  const { role, loading: roleLoading } = useRole();
  const { log } = useAudit();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tab: tabParam, id: focusId } = useLocalSearchParams<{ tab?: string; id?: string }>();
  // Finance staff handle payment/purchase/deposit verification; operational queues
  // (bookings, maintenance, feedback) are hidden from them.
  const isFinance = role === 'finance';

  const [activeSection, setActiveSection] = useState<DashboardSection>('money');
  const [activeTab, setActiveTab] = useState<DashboardTab>('payments');
  const [materialsRequest, setMaterialsRequest] = useState<MaintenanceRequest | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [convertLeaseSource, setConvertLeaseSource] = useState<LeaseConversionSource | null>(null);
  const [pendingAccountCount, setPendingAccountCount] = useState(0);
  const listRef = useRef<FlatList>(null);

  const roleReady = !roleLoading && !!role;
  const statsQuery = useAdminDashboardStats(roleReady);
  const queuesQuery = useAdminDashboardQueues(!isFinance, roleReady);

  const payments = (queuesQuery.data?.payments as unknown as Payment[]) || [];
  const purchases = (queuesQuery.data?.purchases as unknown as PendingPurchaseQueueItem[]) || [];
  const deposits = useMemo(() => {
    const items = (queuesQuery.data?.deposits as unknown as PendingDepositQueueItem[]) || [];
    return [...items].sort((a, b) => {
      const aReady = isDepositReadyForLease(a) ? 1 : 0;
      const bReady = isDepositReadyForLease(b) ? 1 : 0;
      if (aReady !== bReady) return aReady - bReady; // pending first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [queuesQuery.data?.deposits]);
  const bookings = (queuesQuery.data?.bookings as unknown as Booking[]) || [];
  const maintenanceRequests = (queuesQuery.data?.maintenance as unknown as MaintenanceRequest[]) || [];
  const feedback = (queuesQuery.data?.feedback as unknown as Feedback[]) || [];
  const loading = roleLoading || (statsQuery.isLoading && !statsQuery.data) || (queuesQuery.isLoading && !queuesQuery.data);

  const queueCounts = useMemo(
    () => ({
      payments: payments.length,
      purchases: purchases.length,
      deposits: deposits.length,
      bookings: bookings.length,
      maintenance: maintenanceRequests.length,
      feedback: feedback.length,
    }),
    [payments.length, purchases.length, deposits.length, bookings.length, maintenanceRequests.length, feedback.length]
  );

  const moneyPendingCount =
    queueCounts.payments + queueCounts.purchases + queueCounts.deposits;
  const opsPendingCount =
    queueCounts.bookings + queueCounts.maintenance + queueCounts.feedback;

  const availableTabs: DashboardTab[] = useMemo(() => {
    if (isFinance) return MONEY_TABS;
    return activeSection === 'money' ? MONEY_TABS : OPS_TABS;
  }, [isFinance, activeSection]);

  const allAllowedTabs: DashboardTab[] = useMemo(
    () => (isFinance ? MONEY_TABS : [...MONEY_TABS, ...OPS_TABS]),
    [isFinance]
  );

  const stats = useMemo(
    () => ({
      totalRevenue: Number(statsQuery.data?.total_revenue ?? 0),
      activeLeases: Number(statsQuery.data?.active_leases ?? 0),
      pendingBookings: Number(statsQuery.data?.pending_bookings ?? 0),
      openMaintenance: Number(statsQuery.data?.open_maintenance ?? 0),
    }),
    [statsQuery.data]
  );

  const selectHighestPendingTab = useCallback(
    (tabs: DashboardTab[]): DashboardTab => {
      let best = tabs[0];
      let bestCount = -1;
      for (const tab of tabs) {
        const count = queueCounts[tab];
        if (count > bestCount) {
          best = tab;
          bestCount = count;
        }
      }
      return best;
    },
    [queueCounts]
  );

  const handleSectionChange = useCallback(
    (section: DashboardSection) => {
      setActiveSection(section);
      const tabs = section === 'money' ? MONEY_TABS : OPS_TABS;
      setActiveTab((current) => (tabs.includes(current) ? current : selectHighestPendingTab(tabs)));
    },
    [selectHighestPendingTab]
  );

  const handleTabChange = useCallback((tab: DashboardTab) => {
    setActiveTab(tab);
    setActiveSection(sectionForTab(tab));
  }, []);

  const loadPendingAccountCount = useCallback(async () => {
    if (isFinance) {
      setPendingAccountCount(0);
      return;
    }
    try {
      const count = await countPendingAccounts();
      setPendingAccountCount(count);
    } catch (err) {
      console.warn('Failed to load pending account count:', err);
    }
  }, [isFinance]);

  const fetchDashboardData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardQueues }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminFinances }),
      loadPendingAccountCount(),
    ]);
  }, [queryClient, loadPendingAccountCount]);

  useEffect(() => {
    if (!roleReady || isFinance) return;
    void loadPendingAccountCount();
  }, [roleReady, isFinance, loadPendingAccountCount]);

  useEffect(() => {
    if (statsQuery.isError || queuesQuery.isError) {
      Alert.alert('Error', 'Failed to load dashboard statistics.');
    }
  }, [statsQuery.isError, queuesQuery.isError]);

  // Keep section/tab valid if the role restricts available queues.
  useEffect(() => {
    if (isFinance) {
      setActiveSection('money');
      if (!MONEY_TABS.includes(activeTab)) {
        setActiveTab('payments');
      }
      return;
    }
    if (!allAllowedTabs.includes(activeTab)) {
      setActiveTab('payments');
      setActiveSection('money');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinance]);

  // Deep-link from notifications: switch section + tab, highlight, and scroll into view.
  useEffect(() => {
    if (tabParam && allAllowedTabs.includes(tabParam as DashboardTab)) {
      const tab = tabParam as DashboardTab;
      setActiveTab(tab);
      setActiveSection(sectionForTab(tab));
    }
    if (focusId) {
      setHighlightedId(focusId);
      router.setParams({ id: undefined, tab: undefined });
    }
  }, [tabParam, focusId, router, allAllowedTabs]);

  useEffect(() => {
    if (!highlightedId || loading) return;
    const data = (() => {
      switch (activeTab) {
        case 'payments':
          return payments;
        case 'purchases':
          return purchases;
        case 'deposits':
          return deposits;
        case 'bookings':
          return bookings;
        case 'maintenance':
          return maintenanceRequests;
        case 'feedback':
          return feedback;
        default: {
          const _exhaustive: never = activeTab;
          return _exhaustive;
        }
      }
    })();
    const index = data.findIndex((item) => item.id === highlightedId);
    if (index < 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
    });
  }, [
    highlightedId,
    loading,
    activeTab,
    payments,
    purchases,
    deposits,
    bookings,
    maintenanceRequests,
    feedback,
  ]);

  const openPurchaseDoc = async (pathOrUrl: string) => {
    try {
      const signed = await createSignedStorageUrl('purchase-documents', pathOrUrl);
      await Linking.openURL(signed);
    } catch (err: any) {
      console.error('Open purchase doc error:', err);
      Alert.alert('Error', err.message || 'Could not open the document.');
    }
  };

  const handleVerifyPayment = async (id: string, action: 'verified' | 'failed') => {
    try {
      const current = payments.find((p) => p.id === id);
      const { error } = await supabase
        .from('payments')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;

      if (action === 'verified' && current) {
        await generateAndAttachReceipt({
          id: current.id,
          amount: current.amount,
          payment_method: current.payment_method,
          reference_code: current.reference_code,
          payment_date: current.payment_date,
          payer_name: current.profiles?.full_name,
          property_title: current.leases?.properties?.title,
        });
      }

      Alert.alert(
        'Success',
        action === 'verified'
          ? 'Payment verified. If this was the first payment on a pending lease, the lease is now active.'
          : 'Payment reference marked as Failed.'
      );
      if (current) {
        await notifyUser({
          userId: current.payer_id,
          type: 'payment_confirmed',
          title: action === 'verified' ? 'Payment Verified' : 'Payment Rejected',
          body:
            action === 'verified'
              ? `Your payment reference ${current.reference_code} has been verified.`
              : `Your payment reference ${current.reference_code} was marked as failed. Please resubmit.`,
          entityType: 'payment',
          entityId: current.id,
        });
      }
      // Refresh statistics after verifying
      fetchDashboardData();
    } catch (err: any) {
      console.error('Verify payment error:', err);
      Alert.alert('Error', 'Failed to update payment status.');
    }
  };

  const handleVerifyPurchase = async (id: string, action: 'verified' | 'failed') => {
    const current = purchases.find((p) => p.id === id);
    if (!current) return;

    try {
      if (action === 'verified') {
        await completePurchase(id);
      } else {
        await rejectPurchase(id);
      }
    } catch (err: any) {
      console.error('Verify purchase error:', err);
      Alert.alert('Error', err.message || 'Failed to update purchase status.');
      return;
    }

    fetchDashboardData();
    Alert.alert(
      'Success',
      action === 'verified'
        ? 'Purchase verified. The property is now marked sold.'
        : 'Purchase marked as failed. Buyer can resubmit.'
    );

    try {
      await log({
        action: 'update',
        entityType: 'purchase',
        entityId: id,
        description:
          action === 'verified'
            ? `Verified property purchase ${current.reference_code} and marked listing sold.`
            : `Rejected property purchase ${current.reference_code}.`,
      });
      await notifyUser({
        userId: current.buyer_id,
        type: 'purchase_update',
        title: action === 'verified' ? 'Purchase Verified' : 'Purchase Rejected',
        body:
          action === 'verified'
            ? `Your purchase for ${current.properties?.title || 'the property'} (ref ${current.reference_code}) was verified. The listing is now sold.`
            : `Your purchase reference ${current.reference_code} was rejected. You can submit again from Explore.`,
        entityType: 'purchase',
        entityId: current.id,
      });
    } catch (err) {
      console.error('Post-verify purchase side effects error:', err);
    }
  };

  const handleVerifyDeposit = async (id: string, action: 'verified' | 'failed') => {
    const current = deposits.find((d) => d.id === id);
    if (!current) return;

    try {
      if (action === 'verified') {
        await completeDepositPayment(id);
      } else {
        await rejectDepositPayment(id);
      }
    } catch (err: any) {
      console.error('Verify deposit error:', err);
      Alert.alert('Error', err.message || 'Failed to update deposit status.');
      return;
    }

    fetchDashboardData();
    Alert.alert(
      'Success',
      action === 'verified'
        ? 'Deposit verified. The property is now reserved.'
        : 'Deposit rejected. Client can resubmit.'
    );

    try {
      await log({
        action: 'update',
        entityType: 'deposit',
        entityId: id,
        description:
          action === 'verified'
            ? `Verified booking deposit ${current.reference_code} and reserved listing.`
            : `Rejected booking deposit ${current.reference_code}.`,
      });
      await notifyUser({
        userId: current.client_id,
        type: 'deposit_update',
        title: action === 'verified' ? 'Deposit Verified' : 'Deposit Rejected',
        body:
          action === 'verified'
            ? `Your security deposit for ${current.properties?.title || 'the property'} (ref ${current.reference_code}) was verified. The listing is reserved.`
            : `Your deposit reference ${current.reference_code} was rejected. You can submit again from Explore.`,
        entityType: 'deposit',
        entityId: current.id,
      });
      if (action === 'verified' && current.properties?.owner_id) {
        try {
          await notifyUser({
            userId: current.properties.owner_id,
            type: 'deposit_update',
            title: 'Deposit Verified on Your Listing',
            body: `A booking deposit for ${current.properties?.title || 'your property'} (ref ${current.reference_code}) was verified.`,
            entityType: 'deposit',
            entityId: current.id,
          });
        } catch (ownerNotifyErr) {
          console.warn('Notify landlord of deposit verify failed:', ownerNotifyErr);
        }
      }
    } catch (err) {
      console.error('Post-verify deposit side effects error:', err);
    }
  };

  const handleReleaseDeposit = async (id: string) => {
    const current = deposits.find((d) => d.id === id);
    if (!current) return;

    Alert.alert(
      'Release reservation',
      `Release the deposit hold on ${current.properties?.title || 'this property'}? The listing will become available again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          style: 'destructive',
          onPress: async () => {
            try {
              await releaseDepositPayment(id, 'Reservation released by staff');
            } catch (err: any) {
              console.error('Release deposit error:', err);
              Alert.alert('Error', err.message || 'Failed to release deposit reservation.');
              return;
            }

            fetchDashboardData();
            Alert.alert('Released', 'Deposit reservation released. The listing is available again.');

            try {
              await log({
                action: 'update',
                entityType: 'deposit',
                entityId: id,
                description: `Released booking deposit ${current.reference_code} and unreserved listing.`,
              });
              await notifyUser({
                userId: current.client_id,
                type: 'deposit_update',
                title: 'Deposit Reservation Released',
                body: `Your deposit hold for ${current.properties?.title || 'the property'} (ref ${current.reference_code}) was released. You can submit again if the listing is available.`,
                entityType: 'deposit',
                entityId: current.id,
              });
            } catch (err) {
              console.error('Post-release deposit side effects error:', err);
            }
          },
        },
      ]
    );
  };

  const handleUploadPurchaseDoc = async (purchase: PendingPurchaseQueueItem) => {
    if (!user?.id) return;
    try {
      const doc = await pickDocument();
      if (!doc) return;

      const docType: PurchaseDocType = doc.mimeType === 'application/pdf' ? 'sale_agreement' : 'other';
      await uploadPurchaseDocument({
        purchaseId: purchase.id,
        uploadedBy: user.id,
        docType,
        title: doc.name,
        doc,
      });

      await log({
        action: 'create',
        entityType: 'purchase_document',
        entityId: purchase.id,
        description: `Uploaded sale document for purchase ${purchase.reference_code}.`,
      });

      Alert.alert('Uploaded', 'Sale document attached to this purchase.');
      fetchDashboardData();
    } catch (err: any) {
      console.error('Upload purchase doc error:', err);
      Alert.alert('Error', err.message || 'Failed to upload document.');
    }
  };

  const handleVerifyBooking = async (
    id: string,
    action: 'approved' | 'declined' | 'completed' | 'cancelled'
  ) => {
    try {
      const current = bookings.find((b) => b.id === id);
      const { error } = await supabase
        .from('bookings')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;

      const labels: Record<typeof action, string> = {
        approved: 'APPROVED',
        declined: 'DECLINED',
        completed: 'COMPLETED',
        cancelled: 'CANCELLED',
      };
      Alert.alert('Success', `Booking request marked as ${labels[action]}.`);
      if (current?.client_id) {
        const titles: Record<typeof action, string> = {
          approved: 'Booking Approved',
          declined: 'Booking Declined',
          completed: 'Viewing Completed',
          cancelled: 'Booking Cancelled',
        };
        const bodies: Record<typeof action, string> = {
          approved: `Your ${current.type} request for ${current.properties?.title || 'a property'} was approved.`,
          declined: `Your ${current.type} request for ${current.properties?.title || 'a property'} was declined.`,
          completed: `Your ${current.type} for ${current.properties?.title || 'a property'} was marked completed.`,
          cancelled: `Your ${current.type} for ${current.properties?.title || 'a property'} was cancelled by staff.`,
        };
        await notifyUser({
          userId: current.client_id,
          type: 'booking_update',
          title: titles[action],
          body: bodies[action],
          entityType: 'booking',
          entityId: current.id,
        });
      }
      fetchDashboardData();
    } catch (err: any) {
      console.error('Verify booking error:', err);
      Alert.alert('Error', 'Failed to update booking status.');
    }
  };

  const handleUpdateMaintenanceStatus = async (id: string, nextStatus: 'pending' | 'in_progress' | 'resolved') => {
    try {
      const current = maintenanceRequests.find((m) => m.id === id);
      const { error } = await supabase
        .from('maintenance_requests')
        .update({ status: nextStatus })
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', `Maintenance status updated to ${nextStatus.replace('_', ' ').toUpperCase()}.`);
      if (current) {
        await notifyUser({
          userId: current.tenant_id,
          type: 'maintenance_update',
          title: 'Maintenance Status Updated',
          body: `Your maintenance ticket "${current.title}" is now ${nextStatus.replace('_', ' ')}.`,
          entityType: 'maintenance',
          entityId: current.id,
        });
      }
      fetchDashboardData();
    } catch (err: any) {
      console.error('Update maintenance status error:', err);
      Alert.alert('Error', 'Failed to update maintenance request status.');
    }
  };

  const handleDeleteFeedback = (id: string) => {
    Alert.alert('Dismiss Feedback', 'Delete this feedback record? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('feedback').delete().eq('id', id);
            if (error) throw error;
            Alert.alert('Success', 'Feedback record deleted.');
            fetchDashboardData();
          } catch (err: any) {
            console.error('Delete feedback error:', err);
            Alert.alert('Error', 'Failed to delete feedback record.');
          }
        },
      },
    ]);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'Admin';
  const todayLabel = new Date().toLocaleDateString('en-KE', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const tabItems = availableTabs.map((tab) => {
    const labels: Record<DashboardTab, string> = {
      payments: 'Payments',
      purchases: 'Purchases',
      deposits: 'Deposits',
      bookings: 'Bookings',
      maintenance: 'Maintenance',
      feedback: 'Feedback',
    };
    const icons = {
      payments: CreditCard,
      purchases: ShoppingBag,
      deposits: Wallet,
      bookings: Calendar,
      maintenance: Wrench,
      feedback: MessageSquare,
    };
    return { key: tab, label: labels[tab], icon: icons[tab], count: queueCounts[tab] };
  });

  const sectionItems = [
    {
      key: 'money',
      label: 'Money',
      icon: Wallet,
      count: moneyPendingCount,
    },
    {
      key: 'ops',
      label: 'Operations',
      icon: Wrench,
      count: opsPendingCount,
    },
  ];

  const renderPaymentItem = (item: Payment) => (
    <QueueCard
      title={item.leases?.properties?.title || 'Rent Payment'}
      badge={{ label: item.payment_method.toUpperCase() }}
      accentColor={adminTheme.colors.accent}
      actions={
        <>
          <QueueCardActionButton
            label="Reject"
            variant="danger"
            onPress={() => handleVerifyPayment(item.id, 'failed')}
            icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
          />
          <QueueCardActionButton
            label="Verify"
            variant="primary"
            onPress={() => handleVerifyPayment(item.id, 'verified')}
            icon={<CheckCircle size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
          />
        </>
      }
    >
      <Text style={styles.amount}>{formatPrice(item.amount)}</Text>
      <Text style={styles.refCode}>
        Reference: <Text style={styles.boldText}>{item.reference_code}</Text>
      </Text>
      {item.proof_url ? (
        <TouchableOpacity onPress={() => openStorageUrl(item.proof_url!).catch(() => Alert.alert('Error', 'Could not open the payment proof.'))}>
          <Text style={[styles.refCode, { marginTop: 6 }]}>View payment proof</Text>
        </TouchableOpacity>
      ) : null}
      <QueueCardDivider />
      <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
        <Text style={styles.clientName}>{item.profiles?.full_name || 'Unknown payer'}</Text>
        <Text style={styles.clientEmail}>{item.profiles?.email || 'No email on file'}</Text>
      </QueueCardInfoRow>
      <Text style={styles.dateText}>Submitted: {formatDate(item.payment_date)}</Text>
    </QueueCard>
  );

  const renderPurchaseItem = (item: PendingPurchaseQueueItem) => {
    const docs = item.purchase_documents || [];
    return (
      <QueueCard
        title={item.properties?.title || 'Property Purchase'}
        badge={{ label: item.payment_method.toUpperCase() }}
        accentColor={adminTheme.colors.warning}
        actions={
          <>
            <QueueCardActionButton
              label="Docs"
              variant="outline"
              onPress={() => handleUploadPurchaseDoc(item)}
              icon={<FilePlus size={16} color={adminTheme.colors.accent} style={styles.btnIcon} />}
            />
            <QueueCardActionButton
              label="Reject"
              variant="danger"
              onPress={() => handleVerifyPurchase(item.id, 'failed')}
              icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
            />
            <QueueCardActionButton
              label="Verify"
              variant="primary"
              onPress={() => handleVerifyPurchase(item.id, 'verified')}
              icon={<CheckCircle size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
            />
          </>
        }
      >
        <Text style={styles.amount}>{formatPrice(Number(item.amount))}</Text>
        <Text style={styles.refCode}>
          Reference: <Text style={styles.boldText}>{item.reference_code}</Text>
        </Text>
        <Text style={styles.locationText}>{item.properties?.location}</Text>
        {item.proof_url ? (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}
            onPress={() => openStorageUrl(item.proof_url!).catch(() => Alert.alert('Error', 'Could not open the payment proof.'))}
          >
            <ExternalLink size={14} color={adminTheme.colors.accent} />
            <Text style={styles.refCode}>View payment proof</Text>
          </TouchableOpacity>
        ) : null}
        {docs.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            {docs.map((doc) => (
              <TouchableOpacity key={doc.id} onPress={() => void openPurchaseDoc(doc.file_url)}>
                <Text style={[styles.refCode, { marginTop: 4 }]}>
                  Doc: {doc.title} ({doc.doc_type})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={[styles.locationText, { marginTop: 6 }]}>
            No sale documents yet — use Docs to attach an agreement.
          </Text>
        )}
        <QueueCardDivider />
        <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
          <Text style={styles.clientName}>{item.profiles?.full_name || 'Unknown buyer'}</Text>
          <Text style={styles.clientEmail}>
            {item.profiles?.email || 'No email'} | {item.profiles?.phone || 'No phone'}
          </Text>
        </QueueCardInfoRow>
        <Text style={styles.dateText}>Submitted: {formatDate(item.created_at)}</Text>
      </QueueCard>
    );
  };

  const openLeaseFromBooking = (item: Booking) => {
    setConvertLeaseSource({
      bookingId: item.id,
      client_id: item.client_id,
      property_id: item.property_id,
      properties: item.properties,
      profiles: item.profiles,
    });
  };

  const openLeaseFromDeposit = (item: PendingDepositQueueItem) => {
    setConvertLeaseSource({
      bookingId: item.booking_id,
      client_id: item.client_id,
      property_id: item.property_id,
      properties: item.properties
        ? {
            title: item.properties.title,
            type: item.properties.type,
            owner_id: item.properties.owner_id ?? null,
            price: item.properties.price,
          }
        : null,
      profiles: item.profiles,
    });
  };

  const renderDepositItem = (item: PendingDepositQueueItem) => {
    const readyForLease = isDepositReadyForLease(item);
    return (
    <QueueCard
      title={item.properties?.title || 'Booking Deposit'}
      badge={{
        label: readyForLease ? 'Ready for lease' : 'Pending verify',
        ...(readyForLease
          ? {
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              borderColor: adminTheme.colors.success,
              textColor: adminTheme.colors.success,
            }
          : {
              backgroundColor: 'rgba(234, 179, 8, 0.15)',
              borderColor: adminTheme.colors.warning,
              textColor: adminTheme.colors.warning,
            }),
      }}
      accentColor={readyForLease ? adminTheme.colors.success : adminTheme.colors.warning}
      actions={
        readyForLease ? (
          <>
            <QueueCardActionButton
              label="Release"
              variant="danger"
              onPress={() => handleReleaseDeposit(item.id)}
              icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
            />
            <QueueCardActionButton
              label="Create Lease"
              variant="primary"
              onPress={() => openLeaseFromDeposit(item)}
              icon={
                <FilePlus
                  size={16}
                  color={adminTheme.colors.onAccent}
                  style={styles.btnIcon}
                />
              }
            />
          </>
        ) : (
          <>
            <QueueCardActionButton
              label="Reject"
              variant="danger"
              onPress={() => handleVerifyDeposit(item.id, 'failed')}
              icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
            />
            <QueueCardActionButton
              label="Verify"
              variant="primary"
              onPress={() => handleVerifyDeposit(item.id, 'verified')}
              icon={<CheckCircle size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
            />
          </>
        )
      }
    >
      <Text style={styles.amount}>{formatPrice(Number(item.amount))}</Text>
      <Text style={styles.refCode}>
        Reference: <Text style={styles.boldText}>{item.reference_code}</Text>
        {' · '}
        {item.payment_method.toUpperCase()}
      </Text>
      <Text style={styles.locationText}>{item.properties?.location}</Text>
      <Text style={[styles.refCode, { marginTop: 4 }]}>
        {readyForLease
          ? 'Deposit verified and listing reserved. Create a lease to assign this house to the tenant.'
          : 'Security deposit (½ month) — reserves property; not rent.'}
      </Text>
      {item.proof_url ? (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}
          onPress={() => openStorageUrl(item.proof_url!).catch(() => Alert.alert('Error', 'Could not open the payment proof.'))}
        >
          <ExternalLink size={14} color={adminTheme.colors.accent} />
          <Text style={styles.refCode}>View payment proof</Text>
        </TouchableOpacity>
      ) : null}
      <QueueCardDivider />
      <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
        <Text style={styles.clientName}>{item.profiles?.full_name || 'Unknown client'}</Text>
        <Text style={styles.clientEmail}>
          {item.profiles?.email || 'No email'} | {item.profiles?.phone || 'No phone'}
        </Text>
      </QueueCardInfoRow>
      <Text style={styles.dateText}>Submitted: {formatDate(item.created_at)}</Text>
    </QueueCard>
    );
  };

  const renderBookingItem = (item: Booking) => {
    const formatBookingDate = (dateStr: string) =>
      new Date(dateStr).toLocaleDateString('en-KE', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

    const formatBookingTime = (dateStr: string) =>
      new Date(dateStr).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

    const typeColors = {
      backgroundColor: adminTheme.colors.accentMuted,
      borderColor: adminTheme.colors.accent,
      textColor: adminTheme.colors.accent,
    };

    const statusLabel = item.status === 'approved' ? 'APPROVED' : 'VIEWING';
    const statusColors =
      item.status === 'approved'
        ? {
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderColor: adminTheme.colors.success,
            textColor: adminTheme.colors.success,
          }
        : typeColors;

    const isRental = item.properties?.type !== 'sale';

    return (
      <QueueCard
        title={item.properties?.title}
        badge={{ label: statusLabel, ...statusColors }}
        accentColor={statusColors.textColor}
        actions={
          item.status === 'approved' ? (
            <>
              {isRental ? (
                <QueueCardActionButton
                  label="Lease"
                  variant="primary"
                  onPress={() => openLeaseFromBooking(item)}
                  icon={<FilePlus size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
                />
              ) : null}
              <QueueCardActionButton
                label="Cancel"
                variant="danger"
                onPress={() => handleVerifyBooking(item.id, 'cancelled')}
                icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
              />
              <QueueCardActionButton
                label="Complete"
                variant="primary"
                onPress={() => handleVerifyBooking(item.id, 'completed')}
                icon={<CheckCheck size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
              />
            </>
          ) : (
            <>
              <QueueCardActionButton
                label="Decline"
                variant="danger"
                onPress={() => handleVerifyBooking(item.id, 'declined')}
                icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
              />
              <QueueCardActionButton
                label="Approve"
                variant="primary"
                onPress={() => handleVerifyBooking(item.id, 'approved')}
                icon={<CheckCircle size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
              />
            </>
          )
        }
      >
        <Text style={styles.locationText}>{item.properties?.location}</Text>
        <QueueCardDivider />
        <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
          <Text style={styles.clientName}>{item.profiles?.full_name}</Text>
          <Text style={styles.clientEmail}>
            {item.profiles?.email} | {item.profiles?.phone || 'No phone'}
          </Text>
        </QueueCardInfoRow>
        <QueueCardInfoRow icon={<Calendar size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
          <Text style={styles.cardDateText}>
            {formatBookingDate(item.booking_date)} at {formatBookingTime(item.booking_date)}
          </Text>
        </QueueCardInfoRow>
        {item.properties?.type === 'sale' ? (
          <Text style={styles.locationText}>
            Sale listing — complete viewing, then verify the buyer's purchase proof (or mark sold
            manually if closed offline).
          </Text>
        ) : null}
        {item.notes ? (
          <View style={styles.noteBox}>
            <FileText size={14} color={adminTheme.colors.textMuted} style={styles.noteIcon} />
            <Text style={styles.noteText}>{item.notes}</Text>
          </View>
        ) : null}
      </QueueCard>
    );
  };

  const renderMaintenanceItem = (item: MaintenanceRequest) => {
    const colors = getPriorityColors(item.priority);
    const formatMaintDate = (dateStr: string) =>
      new Date(dateStr).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

    return (
      <QueueCard
        title={item.title}
        badge={{ label: item.priority.toUpperCase(), ...colors }}
        accentColor={colors.textColor}
        actions={
          <>
            {item.status === 'pending' ? (
              <QueueCardActionButton
                label="Start Work"
                variant="outline"
                onPress={() => handleUpdateMaintenanceStatus(item.id, 'in_progress')}
                icon={<Clock size={16} color={adminTheme.colors.accent} style={styles.btnIcon} />}
              />
            ) : null}
            {item.status === 'in_progress' ? (
              <View style={styles.inProgressBadge}>
                <Clock size={14} color={adminTheme.colors.accent} style={styles.btnIcon} />
                <Text style={styles.inProgressBadgeText}>In Progress</Text>
              </View>
            ) : null}
            <QueueCardActionButton
              label="Resolve"
              variant="primary"
              onPress={() => handleUpdateMaintenanceStatus(item.id, 'resolved')}
              icon={<CheckCircle size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
              flex={item.status === 'pending' ? 1 : 1}
            />
          </>
        }
        footer={
          <TouchableOpacity style={styles.materialsRow} onPress={() => setMaterialsRequest(item)}>
            <Package size={14} color={adminTheme.colors.textMuted} style={styles.btnIcon} />
            <Text style={styles.materialsRowText}>Record materials used</Text>
          </TouchableOpacity>
        }
      >
        <Text style={styles.locationText}>Property: {item.properties?.title}</Text>
        <QueueCardDivider />
        <Text style={styles.maintDesc}>{item.description}</Text>
        {item.image_urls?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.maintImageRow}>
            {item.image_urls.map((uri) => (
              <StorageImage key={uri} uri={uri} style={styles.maintImage} contentFit="cover" cachePolicy="memory-disk" />
            ))}
          </ScrollView>
        ) : null}
        <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
          <Text style={styles.clientName}>Tenant: {item.profiles?.full_name}</Text>
        </QueueCardInfoRow>
        <QueueCardInfoRow icon={<Clock size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
          <Text style={styles.cardDateText}>
            Reported: {formatMaintDate(item.created_at)} •{' '}
            <Text
              style={{
                color: item.status === 'in_progress' ? adminTheme.colors.accent : adminTheme.colors.warning,
                fontWeight: '700',
              }}
            >
              {item.status.replace('_', ' ').toUpperCase()}
            </Text>
          </Text>
        </QueueCardInfoRow>
      </QueueCard>
    );
  };

  const renderFeedbackItem = (item: Feedback) => {
    const colors = getFeedbackBadgeColors(item.type);
    const formatFeedbackDate = (dateStr: string) =>
      new Date(dateStr).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

    return (
      <QueueCard
        title={item.profiles?.full_name || 'Anonymous User'}
        badge={{ label: item.type.toUpperCase(), ...colors }}
        accentColor={colors.textColor}
        actions={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <QueueCardActionButton
              label="Reply"
              variant="primary"
              onPress={() =>
                router.push({ pathname: '/(admin)/support', params: { id: item.id } })
              }
              icon={<MessageSquare size={16} color={adminTheme.colors.onAccent} style={styles.btnIcon} />}
            />
            <QueueCardActionButton
              label="Dismiss"
              variant="danger"
              onPress={() => handleDeleteFeedback(item.id)}
              icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
            />
          </View>
        }
      >
        <Text style={styles.clientEmail}>{item.profiles?.email}</Text>
        <QueueCardDivider />
        <View style={styles.feedbackContentBox}>
          <MessageSquare size={16} color={adminTheme.colors.textMuted} style={styles.noteIcon} />
          <Text style={styles.feedbackMessage}>{item.message}</Text>
        </View>
        <Text style={styles.feedbackDate}>Submitted: {formatFeedbackDate(item.created_at)}</Text>
      </QueueCard>
    );
  };

  const renderHeader = () => {
    const listTitles: Record<DashboardTab, string> = {
      payments: 'Pending Payment Proofs',
      purchases: 'Pending Property Purchases',
      deposits: 'Booking Deposits',
      bookings: 'Viewing Requests',
      maintenance: 'Active Maintenance Tickets',
      feedback: 'User Feedback & Complaints',
    };

    const showMoneyStats = isFinance || activeSection === 'money';

    return (
      <View style={styles.statsContainer}>
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              {getGreeting()}, {firstName}
            </Text>
            <Text style={styles.dateLabel}>{todayLabel}</Text>
            <Text style={styles.hubSubtitle}>
              {isFinance
                ? 'Payment, Purchase & Deposit Verification'
                : 'Money & Operations'}
            </Text>
          </View>
          <NotificationBell href="/(admin)/notifications" />
        </View>

        {!isFinance && pendingAccountCount > 0 ? (
          <TouchableOpacity
            style={styles.pendingApprovalsStrip}
            onPress={() => router.navigate('/(admin)/users' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.pendingApprovalsIcon}>
              <Users size={18} color={adminTheme.colors.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingApprovalsTitle}>
                {pendingAccountCount} pending account{pendingAccountCount === 1 ? '' : 's'}
              </Text>
              <Text style={styles.pendingApprovalsLead}>
                Review self-signups before they can access the app.
              </Text>
            </View>
            <Text style={styles.pendingApprovalsCta}>Review</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.statsTitle}>Overview Insights</Text>
        <View style={styles.statsGrid}>
          {showMoneyStats ? (
            <>
              <StatCard
                label="Revenue"
                value={formatPrice(stats.totalRevenue)}
                icon={Wallet}
                accentColor={adminTheme.colors.accent}
              />
              <StatCard
                label="Payments"
                value={String(queueCounts.payments)}
                icon={CreditCard}
                accentColor={adminTheme.colors.warning}
              />
              <StatCard
                label="Purchases"
                value={String(queueCounts.purchases)}
                icon={ShoppingBag}
                accentColor={adminTheme.colors.accent}
              />
              <StatCard
                label="Deposits"
                value={String(queueCounts.deposits)}
                icon={Wallet}
                accentColor={adminTheme.colors.success}
              />
            </>
          ) : (
            <>
              <StatCard
                label="Leases"
                value={String(stats.activeLeases)}
                icon={LeaseIcon}
                accentColor={adminTheme.colors.success}
              />
              <StatCard
                label="Bookings"
                value={String(stats.pendingBookings)}
                icon={Calendar}
                accentColor={adminTheme.colors.warning}
              />
              <StatCard
                label="Maintenance"
                value={String(stats.openMaintenance)}
                icon={Wrench}
                accentColor={adminTheme.colors.danger}
              />
              <StatCard
                label="Feedback"
                value={String(queueCounts.feedback)}
                icon={MessageSquare}
                accentColor={adminTheme.colors.accent}
              />
            </>
          )}
        </View>

        {!isFinance ? (
          <SegmentedTabs
            tabs={sectionItems}
            activeKey={activeSection}
            onChange={(key) => handleSectionChange(key as DashboardSection)}
          />
        ) : null}

        <SegmentedTabs
          tabs={tabItems}
          activeKey={activeTab}
          onChange={(key) => handleTabChange(key as DashboardTab)}
        />

        <Text style={styles.listTitle}>{listTitles[activeTab]}</Text>
      </View>
    );
  };

  const getActiveData = () => {
    switch (activeTab) {
      case 'payments':
        return payments;
      case 'purchases':
        return purchases;
      case 'deposits':
        return deposits;
      case 'bookings':
        return bookings;
      case 'maintenance':
        return maintenanceRequests;
      case 'feedback':
        return feedback;
      default: {
        const _exhaustive: never = activeTab;
        return _exhaustive;
      }
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    let content = null;
    switch (activeTab) {
      case 'payments':
        content = renderPaymentItem(item);
        break;
      case 'purchases':
        content = renderPurchaseItem(item);
        break;
      case 'deposits':
        content = renderDepositItem(item);
        break;
      case 'bookings':
        content = renderBookingItem(item);
        break;
      case 'maintenance':
        content = renderMaintenanceItem(item);
        break;
      case 'feedback':
        content = renderFeedbackItem(item);
        break;
      default: {
        const _exhaustive: never = activeTab;
        return _exhaustive;
      }
    }
    return (
      <View style={highlightedId === item.id ? styles.highlightedWrap : undefined}>
        {content}
      </View>
    );
  };

  const getEmptyMessage = () => {
    switch (activeTab) {
      case 'payments':
        return 'No pending rent payments awaiting verification.';
      case 'purchases':
        return 'No pending property purchases awaiting verification.';
      case 'deposits':
        return isFinance
          ? 'No pending booking deposits awaiting verification.'
          : 'No pending deposits to verify, and no verified deposits waiting for a lease.';
      case 'bookings':
        return 'No viewing requests awaiting review. Approve appears here after a client submits Book Viewing. For deposit-only cases, use Create Lease on the Deposits tab.';
      case 'maintenance':
        return 'No active maintenance tickets pending attention.';
      case 'feedback':
        return 'No feedback logs found.';
      default: {
        const _exhaustive: never = activeTab;
        return _exhaustive;
      }
    }
  };

  const initialLoad = loading && payments.length === 0 && !roleLoading;

  return (
    <View style={styles.container}>
      {initialLoad ? (
        <DashboardSkeleton />
      ) : (
        <FlatList
          ref={listRef}
          data={getActiveData()}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchDashboardData}
          refreshing={queuesQuery.isRefetching || statsQuery.isRefetching}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true,
            });
          }}
          initialNumToRender={LIST_PERF.initialNumToRender}
          windowSize={LIST_PERF.windowSize}
          maxToRenderPerBatch={LIST_PERF.maxToRenderPerBatch}
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <ShieldAlert size={48} color={adminTheme.colors.textMuted} style={styles.emptyIcon} />
              <Text style={styles.emptyText}>{getEmptyMessage()}</Text>
            </View>
          }
        />
      )}

      <MaterialsUsedModal
        visible={!!materialsRequest}
        onClose={() => setMaterialsRequest(null)}
        maintenanceRequestId={materialsRequest?.id || ''}
        maintenanceTitle={materialsRequest?.title || ''}
        userId={user?.id || ''}
      />

      <ConvertBookingToLeaseModal
        visible={!!convertLeaseSource}
        source={convertLeaseSource}
        onClose={() => setConvertLeaseSource(null)}
        onCreated={() => {
          setConvertLeaseSource(null);
          fetchDashboardData();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: adminTheme.colors.bg,
  },
  listContainer: {
    padding: adminTheme.spacing.lg,
    paddingBottom: adminTheme.spacing.xxl,
  },
  statsContainer: {
    marginBottom: adminTheme.spacing.lg,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: adminTheme.colors.text,
    marginBottom: 4,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  highlightedWrap: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: adminTheme.colors.accent,
    marginBottom: 4,
  },
  dateLabel: {
    fontSize: 13,
    color: adminTheme.colors.textMuted,
    marginBottom: 4,
  },
  hubSubtitle: {
    fontSize: 14,
    color: adminTheme.colors.accent,
    fontWeight: '600',
    marginBottom: adminTheme.spacing.lg,
  },
  pendingApprovalsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: adminTheme.spacing.md,
    backgroundColor: adminTheme.colors.accentMuted,
    borderColor: adminTheme.colors.accent,
    borderWidth: 1,
    borderRadius: adminTheme.radius.md,
    padding: adminTheme.spacing.md,
    marginBottom: adminTheme.spacing.lg,
  },
  pendingApprovalsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: adminTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingApprovalsTitle: {
    color: adminTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  pendingApprovalsLead: {
    color: adminTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  pendingApprovalsCta: {
    color: adminTheme.colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  statsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: adminTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: adminTheme.spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -adminTheme.spacing.xs,
    marginBottom: adminTheme.spacing.lg,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: adminTheme.colors.text,
    marginBottom: adminTheme.spacing.sm,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: adminTheme.colors.text,
    marginVertical: 6,
  },
  refCode: {
    color: adminTheme.colors.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  boldText: {
    color: adminTheme.colors.text,
    fontWeight: '700',
  },
  icon: {
    marginRight: 10,
  },
  clientName: {
    color: adminTheme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  clientEmail: {
    color: adminTheme.colors.textMuted,
    fontSize: 12,
  },
  dateText: {
    fontSize: 11,
    color: adminTheme.colors.textDim,
  },
  btnIcon: {
    marginRight: 6,
  },
  locationText: {
    fontSize: 13,
    color: adminTheme.colors.textMuted,
    marginBottom: 4,
  },
  cardDateText: {
    color: adminTheme.colors.text,
    fontSize: 14,
  },
  noteBox: {
    flexDirection: 'row',
    backgroundColor: adminTheme.colors.bg,
    borderRadius: adminTheme.radius.sm,
    padding: 10,
    marginTop: 6,
  },
  noteIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  noteText: {
    color: adminTheme.colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  maintDesc: {
    color: adminTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: adminTheme.spacing.sm,
  },
  maintImageRow: {
    marginBottom: adminTheme.spacing.sm,
  },
  maintImage: {
    width: 88,
    height: 88,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: adminTheme.colors.bg,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
  },
  inProgressBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: adminTheme.colors.accentMuted,
    borderColor: adminTheme.colors.accent,
    borderWidth: 1,
    borderRadius: adminTheme.radius.sm,
    paddingVertical: 12,
    marginRight: adminTheme.spacing.sm,
  },
  inProgressBadgeText: {
    color: adminTheme.colors.accent,
    fontWeight: '700',
    fontSize: 12,
  },
  materialsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  materialsRowText: {
    color: adminTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  feedbackContentBox: {
    flexDirection: 'row',
    backgroundColor: adminTheme.colors.bg,
    borderRadius: adminTheme.radius.sm,
    padding: adminTheme.spacing.md,
    marginVertical: 6,
  },
  feedbackMessage: {
    color: adminTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  feedbackDate: {
    fontSize: 11,
    color: adminTheme.colors.textDim,
    marginTop: 6,
  },
  emptyCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: adminTheme.spacing.xxl,
  },
  emptyIcon: {
    marginBottom: adminTheme.spacing.lg,
  },
  emptyText: {
    color: adminTheme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
});

