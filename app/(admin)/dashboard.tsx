import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  CreditCard,
  User,
  Check,
  X,
  ShieldAlert,
  Calendar,
  Wrench,
  MessageSquare,
  Clock,
  HelpCircle,
  CheckCircle,
  FileText,
} from 'lucide-react-native';

interface Payment {
  id: string;
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

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'payments' | 'bookings' | 'maintenance' | 'feedback'>('payments');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalRevenue: 0, activeLeases: 0, pendingBookings: 0, openMaintenance: 0 });

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch pending payments
      const { data: payData, error: payError } = await supabase
        .from('payments')
        .select(`
          id,
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
      const { data: maintData, error: maintError } = await supabase
        .from('maintenance_requests')
        .select(`
          id,
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
      setMaintenanceRequests((maintData as any) || []);

      // 4. Fetch feedback
      const { data: feedData, error: feedError } = await supabase
        .from('feedback')
        .select(`
          id,
          type,
          message,
          created_at,
          profiles ( full_name, email )
        `)
        .order('created_at', { ascending: false });

      if (feedError) throw feedError;
      setFeedback((feedData as any) || []);

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

      // 7. Fetch count of pending bookings
      const { count: bookingCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const openMaintCount = maintData ? maintData.length : 0;

      setStats({
        totalRevenue: sum,
        activeLeases: leaseCount || 0,
        pendingBookings: bookingCount || 0,
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
    fetchDashboardData();
  }, []);

  const handleVerifyPayment = async (id: string, action: 'verified' | 'failed') => {
    try {
      const { error } = await supabase
        .from('payments')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', `Payment reference marked as ${action === 'verified' ? 'Verified' : 'Failed'}.`);
      setPayments((prev) => prev.filter((p) => p.id !== id));
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

  const renderPaymentItem = (item: Payment) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.propTitle}>
          {item.leases?.properties?.title || 'Rent Payment'}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.payment_method.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.amount}>{formatPrice(item.amount)}</Text>
      <Text style={styles.refCode}>Reference: <Text style={styles.boldText}>{item.reference_code}</Text></Text>

      <View style={styles.divider} />

      <View style={styles.infoRow}>
        <User size={16} color="#38BDF8" style={styles.icon} />
        <View>
          <Text style={styles.clientName}>{item.profiles?.full_name}</Text>
          <Text style={styles.clientEmail}>{item.profiles?.email}</Text>
        </View>
      </View>

      <Text style={styles.dateText}>Submitted: {formatDate(item.payment_date)}</Text>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={() => handleVerifyPayment(item.id, 'failed')}
        >
          <X size={16} color="#EF4444" style={styles.btnIcon} />
          <Text style={styles.rejectText}>Reject</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={() => handleVerifyPayment(item.id, 'verified')}
        >
          <Check size={16} color="#0F172A" style={styles.btnIcon} />
          <Text style={styles.approveText}>Verify & Approve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderBookingItem = (item: Booking) => {
    const formatBookingDate = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-KE', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    };

    const formatBookingTime = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-KE', {
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.propTitle}>{item.properties?.title}</Text>
          <View style={[
            styles.badge,
            item.type === 'reservation' ? styles.badgeReservation : styles.badgeViewing
          ]}>
            <Text style={styles.badgeText}>{item.type.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.locationText}>{item.properties?.location}</Text>

        <View style={styles.divider} />

        <View style={styles.infoRow}>
          <User size={16} color="#38BDF8" style={styles.icon} />
          <View>
            <Text style={styles.clientName}>{item.profiles?.full_name}</Text>
            <Text style={styles.clientEmail}>{item.profiles?.email} | {item.profiles?.phone || 'No phone'}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Calendar size={16} color="#38BDF8" style={styles.icon} />
          <Text style={styles.cardDateText}>{formatBookingDate(item.booking_date)} at {formatBookingTime(item.booking_date)}</Text>
        </View>

        {item.notes ? (
          <View style={styles.noteBox}>
            <FileText size={14} color="#94A3B8" style={styles.noteIcon} />
            <Text style={styles.noteText}>{item.notes}</Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => handleVerifyBooking(item.id, 'declined')}
          >
            <X size={16} color="#EF4444" style={styles.btnIcon} />
            <Text style={styles.rejectText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => handleVerifyBooking(item.id, 'approved')}
          >
            <Check size={16} color="#0F172A" style={styles.btnIcon} />
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderMaintenanceItem = (item: MaintenanceRequest) => {
    const getPriorityColors = (p: string) => {
      switch (p) {
        case 'high':
          return { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#EF4444' };
        case 'medium':
          return { bg: 'rgba(234, 179, 8, 0.15)', border: '#EAB308', text: '#EAB308' };
        default:
          return { bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981', text: '#10B981' };
      }
    };

    const formatMaintDate = (dateStr: string) => {
      return new Date(dateStr).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    };

    const colors = getPriorityColors(item.priority);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.propTitle}>{item.title}</Text>
          <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>{item.priority.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.locationText}>Property: {item.properties?.title}</Text>

        <View style={styles.divider} />

        <Text style={styles.maintDesc}>{item.description}</Text>

        <View style={styles.infoRow}>
          <User size={16} color="#38BDF8" style={styles.icon} />
          <Text style={styles.clientName}>Tenant: {item.profiles?.full_name}</Text>
        </View>

        <View style={styles.infoRow}>
          <Clock size={16} color="#38BDF8" style={styles.icon} />
          <Text style={styles.cardDateText}>
            Reported: {formatMaintDate(item.created_at)} • Status: <Text style={{ color: item.status === 'in_progress' ? '#38BDF8' : '#EAB308', fontWeight: 'bold' }}>{item.status.replace('_', ' ').toUpperCase()}</Text>
          </Text>
        </View>

        <View style={styles.actionRow}>
          {item.status === 'pending' && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.pendingMaintBtn]}
              onPress={() => handleUpdateMaintenanceStatus(item.id, 'in_progress')}
            >
              <Clock size={16} color="#38BDF8" style={styles.btnIcon} />
              <Text style={styles.pendingMaintText}>Start Work</Text>
            </TouchableOpacity>
          )}

          {item.status === 'in_progress' && (
            <View style={{ flex: 1, paddingRight: 4 }}>
              <View style={styles.inProgressBadge}>
                <Clock size={14} color="#38BDF8" style={{ marginRight: 4 }} />
                <Text style={styles.inProgressBadgeText}>In Progress</Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, styles.resolveBtn]}
            onPress={() => handleUpdateMaintenanceStatus(item.id, 'resolved')}
          >
            <CheckCircle size={16} color="#0F172A" style={styles.btnIcon} />
            <Text style={styles.resolveText}>Mark Resolved</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFeedbackItem = (item: Feedback) => {
    const getFeedbackBadgeColors = (type: string) => {
      switch (type) {
        case 'complaint':
          return { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#EF4444' };
        case 'suggestion':
          return { bg: 'rgba(56, 189, 248, 0.15)', border: '#38BDF8', text: '#38BDF8' };
        default:
          return { bg: 'rgba(234, 179, 8, 0.15)', border: '#EAB308', text: '#EAB308' };
      }
    };

    const formatFeedbackDate = (dateStr: string) => {
      return new Date(dateStr).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const colors = getFeedbackBadgeColors(item.type);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.feedbackUser}>{item.profiles?.full_name || 'Anonymous User'}</Text>
          <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>{item.type.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.clientEmail}>{item.profiles?.email}</Text>

        <View style={styles.divider} />

        <View style={styles.feedbackContentBox}>
          <MessageSquare size={16} color="#94A3B8" style={styles.noteIcon} />
          <Text style={styles.feedbackMessage}>{item.message}</Text>
        </View>

        <Text style={styles.feedbackDate}>Submitted: {formatFeedbackDate(item.created_at)}</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteFeedbackBtn]}
            onPress={() => handleDeleteFeedback(item.id)}
          >
            <X size={16} color="#EF4444" style={styles.btnIcon} />
            <Text style={styles.deleteFeedbackText}>Dismiss / Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSegmentedControl = () => (
    <View style={styles.segmentContainer}>
      {(['payments', 'bookings', 'maintenance', 'feedback'] as const).map((tab) => {
        const getTabLabel = (t: string) => {
          switch (t) {
            case 'payments': return 'Payments';
            case 'bookings': return 'Bookings';
            case 'maintenance': return 'Maint';
            case 'feedback': return 'Feedback';
            default: return '';
          }
        };

        const getTabIcon = (t: string, color: string) => {
          switch (t) {
            case 'payments': return <CreditCard size={12} color={color} style={styles.tabIcon} />;
            case 'bookings': return <Calendar size={12} color={color} style={styles.tabIcon} />;
            case 'maintenance': return <Wrench size={12} color={color} style={styles.tabIcon} />;
            case 'feedback': return <MessageSquare size={12} color={color} style={styles.tabIcon} />;
            default: return null;
          }
        };

        const isActive = activeTab === tab;
        const color = isActive ? '#38BDF8' : '#94A3B8';

        return (
          <TouchableOpacity
            key={tab}
            style={[styles.segmentBtn, isActive && styles.segmentBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            {getTabIcon(tab, color)}
            <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
              {getTabLabel(tab)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderHeader = () => {
    const getListTitle = () => {
      switch (activeTab) {
        case 'payments': return 'Pending Payment Proofs';
        case 'bookings': return 'Pending Viewing / Reservations';
        case 'maintenance': return 'Active Maintenance Tickets';
        case 'feedback': return 'User Feedback & Complaints';
        default: return '';
      }
    };

    return (
      <View style={styles.statsContainer}>
        <Text style={styles.statsTitle}>Overview Insights</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Revenue</Text>
            <Text style={styles.statVal}>{formatPrice(stats.totalRevenue)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Leases</Text>
            <Text style={styles.statVal}>{stats.activeLeases}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Bookings</Text>
            <Text style={styles.statVal}>{stats.pendingBookings}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Maint.</Text>
            <Text style={styles.statVal}>{stats.openMaintenance}</Text>
          </View>
        </View>

        {renderSegmentedControl()}

        <Text style={styles.listTitle}>{getListTitle()}</Text>
      </View>
    );
  };

  const getActiveData = () => {
    switch (activeTab) {
      case 'payments': return payments;
      case 'bookings': return bookings;
      case 'maintenance': return maintenanceRequests;
      case 'feedback': return feedback;
      default: return [];
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
      case 'payments': return 'No pending rent payments awaiting verification.';
      case 'bookings': return 'No pending viewing or reservation requests.';
      case 'maintenance': return 'No active maintenance tickets pending attention.';
      case 'feedback': return 'No feedback logs found.';
      default: return 'No items found.';
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
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
              <ShieldAlert size={48} color="#94A3B8" style={styles.emptyIcon} />
              <Text style={styles.emptyText}>{getEmptyMessage()}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  listContainer: {
    padding: 16,
  },
  statsContainer: {
    marginBottom: 20,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 10,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 4,
  },
  statVal: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  listTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  propTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#94A3B8',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderColor: '#38BDF8',
    borderWidth: 1,
  },
  badgeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: 'bold',
  },
  amount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginVertical: 6,
  },
  refCode: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '500',
  },
  boldText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  icon: {
    marginRight: 10,
  },
  clientName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  clientEmail: {
    color: '#94A3B8',
    fontSize: 12,
  },
  dateText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 14,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  rejectBtn: {
    borderColor: '#EF4444',
    borderWidth: 1,
    marginRight: 8,
  },
  approveBtn: {
    backgroundColor: '#38BDF8',
    marginLeft: 8,
  },
  btnIcon: {
    marginRight: 6,
  },
  rejectText: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
  approveText: {
    color: '#0F172A',
    fontWeight: 'bold',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
  },
  
  // Segmented Control Styles
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 20,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 6,
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
  },
  segmentText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  segmentTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  tabIcon: {
    marginRight: 2,
  },
  
  // Booking Custom Styles
  locationText: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
    marginBottom: 6,
  },
  cardDateText: {
    color: '#F8FAFC',
    fontSize: 14,
  },
  noteBox: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    padding: 10,
    marginTop: 6,
    marginBottom: 14,
  },
  noteIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  noteText: {
    color: '#94A3B8',
    fontSize: 13,
    flex: 1,
  },
  badgeReservation: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderColor: '#EAB308',
    borderWidth: 1,
  },
  badgeViewing: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38BDF8',
    borderWidth: 1,
  },

  // Maintenance Custom Styles
  maintDesc: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  pendingMaintBtn: {
    borderColor: '#38BDF8',
    borderWidth: 1,
    marginRight: 8,
  },
  pendingMaintText: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  resolveBtn: {
    backgroundColor: '#38BDF8',
    marginLeft: 8,
  },
  resolveText: {
    color: '#0F172A',
    fontWeight: 'bold',
  },
  inProgressBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    marginRight: 8,
  },
  inProgressBadgeText: {
    color: '#38BDF8',
    fontWeight: 'bold',
    fontSize: 12,
  },

  // Feedback Custom Styles
  feedbackUser: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  feedbackContentBox: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
  },
  feedbackMessage: {
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  feedbackDate: {
    fontSize: 11,
    color: '#64748B',
    marginVertical: 10,
  },
  deleteFeedbackBtn: {
    borderColor: '#EF4444',
    borderWidth: 1,
    flex: 1,
  },
  deleteFeedbackText: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
});

