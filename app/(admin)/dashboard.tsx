import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useRole } from '../../hooks/useRole';
import { notifyUser } from '../../lib/notifications';
import MaterialsUsedModal from '../../components/MaterialsUsedModal';
import StatCard from '../../components/admin/StatCard';
import SegmentedTabs from '../../components/admin/SegmentedTabs';
import QueueCard, {
  QueueCardDivider,
  QueueCardInfoRow,
  QueueCardActionButton,
} from '../../components/admin/QueueCard';
import DashboardSkeleton from '../../components/admin/DashboardSkeleton';
import { adminTheme } from '../../constants/adminTheme';
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
  FileText,
  Package,
  Wallet,
  FileText as LeaseIcon,
} from 'lucide-react-native';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getPriorityColors(p: string) {
  switch (p) {
    case 'high':
      return { bg: 'rgba(239, 68, 68, 0.15)', border: adminTheme.colors.danger, text: adminTheme.colors.danger };
    case 'medium':
      return { bg: 'rgba(234, 179, 8, 0.15)', border: adminTheme.colors.warning, text: adminTheme.colors.warning };
    default:
      return { bg: 'rgba(16, 185, 129, 0.15)', border: adminTheme.colors.success, text: adminTheme.colors.success };
  }
}

function getFeedbackBadgeColors(type: string) {
  switch (type) {
    case 'complaint':
      return { bg: 'rgba(239, 68, 68, 0.15)', border: adminTheme.colors.danger, text: adminTheme.colors.danger };
    case 'suggestion':
      return { bg: adminTheme.colors.accentMuted, border: adminTheme.colors.accent, text: adminTheme.colors.accent };
    default:
      return { bg: 'rgba(234, 179, 8, 0.15)', border: adminTheme.colors.warning, text: adminTheme.colors.warning };
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
  booking_date: string;
  type: 'viewing' | 'reservation';
  status: 'pending' | 'approved' | 'declined';
  notes: string;
  properties: {
    title: string;
    location: string;
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
  // Finance staff only handle payment verification; operational queues
  // (bookings, maintenance, feedback) are hidden from them.
  const isFinance = role === 'finance';
  const availableTabs: DashboardTab[] = isFinance
    ? ['payments']
    : ['payments', 'bookings', 'maintenance', 'feedback'];

  const [activeTab, setActiveTab] = useState<DashboardTab>('payments');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalRevenue: 0, activeLeases: 0, pendingBookings: 0, openMaintenance: 0 });
  const [materialsRequest, setMaterialsRequest] = useState<MaintenanceRequest | null>(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch pending payments
      const { data: payData, error: payError } = await supabase
        .from('payments')
        .select(`
          id,
          payer_id,
          amount,
          payment_method,
          reference_code,
          payment_date,
          status,
          profiles ( full_name, email ),
          leases (
            properties ( title )
          )
        `)
        .eq('status', 'pending')
        .order('payment_date', { ascending: true });

      if (payError) throw payError;
      setPayments((payData as any) || []);

      let maintData: any[] | null = null;

      // Operational queues (bookings, maintenance, feedback) are only relevant
      // to admins. Finance staff skip these queries entirely.
      if (!isFinance) {
        // 2. Fetch pending bookings
        const { data: bookData, error: bookError } = await supabase
          .from('bookings')
          .select(`
            id,
            booking_date,
            type,
            status,
            notes,
            properties ( title, location ),
            profiles ( full_name, email, phone )
          `)
          .eq('status', 'pending')
          .order('booking_date', { ascending: true });

        if (bookError) throw bookError;
        setBookings((bookData as any) || []);

        // 3. Fetch active maintenance requests
        const { data: maintResult, error: maintError } = await supabase
          .from('maintenance_requests')
          .select(`
            id,
            tenant_id,
            title,
            description,
            priority,
            status,
            created_at,
            properties ( title ),
            profiles ( full_name )
          `)
          .neq('status', 'resolved')
          .order('created_at', { ascending: false });

        if (maintError) throw maintError;
        maintData = maintResult;
        setMaintenanceRequests((maintResult as any) || []);

        // 4. Fetch feedback
        const { data: feedData, error: feedError } = await supabase
          .from('feedback')
          .select(`
            id,
            type,
            message,
            created_at,
            profiles!feedback_user_id_fkey ( full_name, email )
          `)
          .order('created_at', { ascending: false });

        if (feedError) throw feedError;
        setFeedback((feedData as any) || []);
      }

      // 5. Fetch sum of verified payments
      const { data: verifiedPays } = await supabase
        .from('payments')
        .select('amount')
        .eq('status', 'verified');
      
      const sum = verifiedPays ? verifiedPays.reduce((acc, curr) => acc + Number(curr.amount), 0) : 0;

      // 6. Fetch count of active leases
      const { count: leaseCount } = await supabase
        .from('leases')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      let bookingCount = 0;
      let openMaintCount = 0;

      if (!isFinance) {
        // 7. Fetch count of pending bookings
        const { count: bookCount } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        bookingCount = bookCount || 0;
        openMaintCount = maintData ? maintData.length : 0;
      }

      setStats({
        totalRevenue: sum,
        activeLeases: leaseCount || 0,
        pendingBookings: bookingCount,
        openMaintenance: openMaintCount,
      });

    } catch (err: any) {
      console.error('Fetch dashboard data error:', err);
      Alert.alert('Error', 'Failed to load dashboard statistics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Wait until the role is known so finance vs admin queries run correctly.
    if (roleLoading) return;
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isFinance]);

  // Keep the active tab valid if the role restricts the available tabs.
  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinance]);

  const handleVerifyPayment = async (id: string, action: 'verified' | 'failed') => {
    try {
      const current = payments.find((p) => p.id === id);
      const { error } = await supabase
        .from('payments')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', `Payment reference marked as ${action === 'verified' ? 'Verified' : 'Failed'}.`);
      setPayments((prev) => prev.filter((p) => p.id !== id));
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

  const handleVerifyBooking = async (id: string, action: 'approved' | 'declined') => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', `Booking request marked as ${action.toUpperCase()}.`);
      setBookings((prev) => prev.filter((b) => b.id !== id));
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
      if (nextStatus === 'resolved') {
        setMaintenanceRequests((prev) => prev.filter((m) => m.id !== id));
      } else {
        setMaintenanceRequests((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: nextStatus } : m))
        );
      }
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

  const handleDeleteFeedback = async (id: string) => {
    try {
      const { error } = await supabase
        .from('feedback')
        .delete()
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', 'Feedback record deleted.');
      setFeedback((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      console.error('Delete feedback error:', err);
      Alert.alert('Error', 'Failed to delete feedback record.');
    }
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
      <QueueCardDivider />
      <QueueCardInfoRow icon={<User size={16} color={adminTheme.colors.accent} style={styles.icon} />}>
        <Text style={styles.clientName}>{item.profiles?.full_name}</Text>
        <Text style={styles.clientEmail}>{item.profiles?.email}</Text>
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

    const typeColors =
      item.type === 'reservation'
        ? { bg: 'rgba(234, 179, 8, 0.15)', border: adminTheme.colors.warning, text: adminTheme.colors.warning }
        : { bg: adminTheme.colors.accentMuted, border: adminTheme.colors.accent, text: adminTheme.colors.accent };

    return (
      <QueueCard
        title={item.properties?.title}
        badge={{ label: item.type.toUpperCase(), ...typeColors }}
        accentColor={typeColors.text}
        actions={
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
        accentColor={colors.text}
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
        accentColor={colors.text}
        actions={
          <QueueCardActionButton
            label="Dismiss"
            variant="danger"
            onPress={() => handleDeleteFeedback(item.id)}
            icon={<X size={16} color={adminTheme.colors.danger} style={styles.btnIcon} />}
          />
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
      bookings: 'Pending Viewing / Reservations',
      maintenance: 'Active Maintenance Tickets',
      feedback: 'User Feedback & Complaints',
    };

    return (
      <View style={styles.statsContainer}>
        <Text style={styles.greeting}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={styles.dateLabel}>{todayLabel}</Text>
        <Text style={styles.hubSubtitle}>
          {isFinance ? 'Payment Verification' : 'Operations Hub'}
        </Text>

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
    switch (activeTab) {
      case 'payments':
        return renderPaymentItem(item);
      case 'bookings':
        return renderBookingItem(item);
      case 'maintenance':
        return renderMaintenanceItem(item);
      case 'feedback':
        return renderFeedbackItem(item);
      default:
        return null;
    }
  };

  const getEmptyMessage = () => {
    switch (activeTab) {
      case 'payments':
        return 'No pending rent payments awaiting verification.';
      case 'bookings':
        return 'No pending viewing or reservation requests.';
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
          data={getActiveData()}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchDashboardData}
          refreshing={loading}
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

