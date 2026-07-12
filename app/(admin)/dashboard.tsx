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
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useRole } from '../../hooks/useRole';
import { notifyUser } from '../../lib/notifications';
import { generateAndAttachReceipt } from '../../lib/receipts';
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
} from 'lucide-react-native';
import ConvertBookingToLeaseModal from '../../components/ConvertBookingToLeaseModal';

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

type DashboardTab = 'payments' | 'bookings' | 'maintenance' | 'feedback';

export default function AdminDashboard() {
  const { user } = useUser();
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tab: tabParam, id: focusId } = useLocalSearchParams<{ tab?: string; id?: string }>();
  // Finance staff only handle payment verification; operational queues
  // (bookings, maintenance, feedback) are hidden from them.
  const isFinance = role === 'finance';
  const availableTabs: DashboardTab[] = useMemo(
    () => (isFinance ? ['payments'] : ['payments', 'bookings', 'maintenance', 'feedback']),
    [isFinance]
  );

  const [activeTab, setActiveTab] = useState<DashboardTab>('payments');
  const [materialsRequest, setMaterialsRequest] = useState<MaintenanceRequest | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [convertBooking, setConvertBooking] = useState<Booking | null>(null);
  const listRef = useRef<FlatList>(null);

  const roleReady = !roleLoading && !!role;
  const statsQuery = useAdminDashboardStats(roleReady);
  const queuesQuery = useAdminDashboardQueues(!isFinance, roleReady);

  const payments = (queuesQuery.data?.payments as unknown as Payment[]) || [];
  const bookings = (queuesQuery.data?.bookings as unknown as Booking[]) || [];
  const maintenanceRequests = (queuesQuery.data?.maintenance as unknown as MaintenanceRequest[]) || [];
  const feedback = (queuesQuery.data?.feedback as unknown as Feedback[]) || [];
  const loading = roleLoading || (statsQuery.isLoading && !statsQuery.data) || (queuesQuery.isLoading && !queuesQuery.data);

  const stats = useMemo(
    () => ({
      totalRevenue: Number(statsQuery.data?.total_revenue ?? 0),
      activeLeases: Number(statsQuery.data?.active_leases ?? 0),
      pendingBookings: Number(statsQuery.data?.pending_bookings ?? 0),
      openMaintenance: Number(statsQuery.data?.open_maintenance ?? 0),
    }),
    [statsQuery.data]
  );

  const fetchDashboardData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardQueues }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    if (statsQuery.isError || queuesQuery.isError) {
      Alert.alert('Error', 'Failed to load dashboard statistics.');
    }
  }, [statsQuery.isError, queuesQuery.isError]);

  // Keep the active tab valid if the role restricts the available tabs.
  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinance]);

  // Deep-link from notifications: switch tab, highlight, and scroll into view.
  useEffect(() => {
    if (tabParam && availableTabs.includes(tabParam as DashboardTab)) {
      setActiveTab(tabParam as DashboardTab);
    }
    if (focusId) {
      setHighlightedId(focusId);
      router.setParams({ id: undefined, tab: undefined });
    }
  }, [tabParam, focusId, router, availableTabs]);

  useEffect(() => {
    if (!highlightedId || loading) return;
    const data = (() => {
      switch (activeTab) {
        case 'payments':
          return payments;
        case 'bookings':
          return bookings;
        case 'maintenance':
          return maintenanceRequests;
        case 'feedback':
          return feedback;
        default:
          return [];
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
    bookings,
    maintenanceRequests,
    feedback,
  ]);

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
      bookings: 'Bookings',
      maintenance: 'Maint.',
      feedback: 'Feedback',
    };
    const icons = {
      payments: CreditCard,
      bookings: Calendar,
      maintenance: Wrench,
      feedback: MessageSquare,
    };
    const counts: Record<DashboardTab, number> = {
      payments: payments.length,
      bookings: bookings.length,
      maintenance: maintenanceRequests.length,
      feedback: feedback.length,
    };
    return { key: tab, label: labels[tab], icon: icons[tab], count: counts[tab] };
  });

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
        <TouchableOpacity onPress={() => Linking.openURL(item.proof_url!)}>
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
                  onPress={() => setConvertBooking(item)}
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
          <Text style={styles.locationText}>Sale listing — complete viewing, then mark property sold when closed.</Text>
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
              <Image key={uri} source={{ uri }} style={styles.maintImage} contentFit="cover" cachePolicy="memory-disk" />
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
      bookings: 'Viewing Requests',
      maintenance: 'Active Maintenance Tickets',
      feedback: 'User Feedback & Complaints',
    };

    return (
      <View style={styles.statsContainer}>
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              {getGreeting()}, {firstName}
            </Text>
            <Text style={styles.dateLabel}>{todayLabel}</Text>
            <Text style={styles.hubSubtitle}>
              {isFinance ? 'Payment Verification' : 'Operations Hub'}
            </Text>
          </View>
          <NotificationBell href="/(admin)/notifications" />
        </View>

        <Text style={styles.statsTitle}>Overview Insights</Text>
        <View style={styles.statsGrid}>
          <StatCard
            label="Revenue"
            value={formatPrice(stats.totalRevenue)}
            icon={Wallet}
            accentColor={adminTheme.colors.accent}
          />
          <StatCard
            label="Leases"
            value={String(stats.activeLeases)}
            icon={LeaseIcon}
            accentColor={adminTheme.colors.success}
          />
          {!isFinance ? (
            <>
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
            </>
          ) : null}
        </View>

        <SegmentedTabs tabs={tabItems} activeKey={activeTab} onChange={(key) => setActiveTab(key as DashboardTab)} />

        <Text style={styles.listTitle}>{listTitles[activeTab]}</Text>
      </View>
    );
  };

  const getActiveData = () => {
    switch (activeTab) {
      case 'payments':
        return payments;
      case 'bookings':
        return bookings;
      case 'maintenance':
        return maintenanceRequests;
      case 'feedback':
        return feedback;
      default:
        return [];
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    let content = null;
    switch (activeTab) {
      case 'payments':
        content = renderPaymentItem(item);
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
      default:
        return null;
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
      case 'bookings':
        return 'No viewing requests awaiting review or completion.';
      case 'maintenance':
        return 'No active maintenance tickets pending attention.';
      case 'feedback':
        return 'No feedback logs found.';
      default:
        return 'No items found.';
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
        visible={!!convertBooking}
        booking={convertBooking}
        onClose={() => setConvertBooking(null)}
        onCreated={() => {
          setConvertBooking(null);
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

