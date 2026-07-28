import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { notifyAdmins } from '../../lib/notifications';
import {
  generatePurchaseReference,
  submitPropertyPurchase,
  type PurchasePaymentMethod,
} from '../../lib/purchases';
import {
  depositAmountFromRent,
  generateDepositReference,
  submitDepositPayment,
  type DepositPaymentMethod,
} from '../../lib/depositPayments';
import {
  clearAuthIntent,
  getAuthIntent,
  setPaymentResumeHold,
  type AuthIntentAction,
} from '../../lib/authIntent';
import { pickDocument, pickImages, type PickedDocument, type PickedImage } from '../../lib/storage';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { useRole } from '../../hooks/useRole';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../hooks/queries/keys';
import { fetchAvailablePropertyById } from '../../hooks/queries/fetchers';
import { Calendar, X, Paperclip } from 'lucide-react-native';
import DatePickerModal from '../../components/DatePickerModal';
import PropertyBrowseList, {
  BrowseProperty,
} from '../../components/PropertyBrowseList';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const PAYMENT_METHODS: { label: string; value: PurchasePaymentMethod }[] = [
  { label: 'M-Pesa Mobile Money', value: 'mpesa' },
  { label: 'Bank Transfer', value: 'bank' },
  { label: 'Cash Payment', value: 'cash' },
];

/** Build an ISO timestamp from local calendar date + wall-clock time. */
function localDateTimeToIso(dateStr: string, timeStr: string): string | null {
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (hh > 23 || mm > 59) return null;
  const local = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  if (
    local.getFullYear() !== y ||
    local.getMonth() !== m - 1 ||
    local.getDate() !== d
  ) {
    return null;
  }
  return local.toISOString();
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(price);
}

export default function PropertiesScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const { role } = useRole();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { action: resumeAction, propertyId: resumePropertyId } = useLocalSearchParams<{
    action?: string;
    propertyId?: string;
  }>();
  const resumeHandledRef = useRef<string | null>(null);
  const resumedPaymentRef = useRef(false);

  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [purchaseModalVisible, setPurchaseModalVisible] = useState(false);
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<BrowseProperty | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('mpesa');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [proof, setProof] = useState<PickedImage | PickedDocument | null>(null);
  const [proofPreviewUri, setProofPreviewUri] = useState<string | null>(null);
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [depositPaymentMethod, setDepositPaymentMethod] =
    useState<DepositPaymentMethod>('mpesa');
  const [depositRefCode, setDepositRefCode] = useState('');
  const [depositProof, setDepositProof] = useState<PickedImage | PickedDocument | null>(null);
  const [depositProofPreviewUri, setDepositProofPreviewUri] = useState<string | null>(null);

  const resetPurchaseForm = () => {
    setPaymentMethod('mpesa');
    setAmount('');
    setRefCode('');
    setProof(null);
    setProofPreviewUri(null);
  };

  const resetDepositForm = () => {
    setDepositPaymentMethod('mpesa');
    setDepositRefCode('');
    setDepositProof(null);
    setDepositProofPreviewUri(null);
  };

  const finishAuthIntent = async () => {
    await clearAuthIntent();
    setPaymentResumeHold(false);
    if (resumedPaymentRef.current && role === 'tenant') {
      resumedPaymentRef.current = false;
      router.replace('/(tenant)/dashboard');
    } else {
      resumedPaymentRef.current = false;
    }
  };

  const closePurchaseModal = () => {
    setPurchaseModalVisible(false);
    resetPurchaseForm();
    void finishAuthIntent();
  };

  const closeDepositModal = () => {
    setDepositModalVisible(false);
    resetDepositForm();
    void finishAuthIntent();
  };

  const handleBookingSubmit = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to submit a viewing request.');
      return;
    }
    if (!selectedProperty) return;

    if (!bookingDate || !bookingTime) {
      Alert.alert('Validation Error', 'Please select a date and enter a time (HH:MM).');
      return;
    }

    const fullDateTime = localDateTimeToIso(bookingDate.trim(), bookingTime.trim());
    if (!fullDateTime) {
      Alert.alert(
        'Validation Error',
        'Use a valid date as YYYY-MM-DD and time as HH:MM (24-hour), e.g. 2026-07-15 and 14:30.'
      );
      return;
    }

    try {
      setSubmittingBooking(true);

      const { data: created, error } = await supabase
        .from('bookings')
        .insert({
          property_id: selectedProperty.id,
          client_id: user.id,
          booking_date: fullDateTime,
          type: 'viewing',
          notes: notes || '',
          status: 'pending',
        })
        .select('id')
        .single();

      if (error) throw error;

      try {
        await notifyAdmins({
          type: 'booking_update',
          title: 'New Viewing Request',
          body: `${user.fullName || 'A client'} requested a viewing for ${selectedProperty.title}.`,
          entityType: 'booking',
          entityId: created?.id,
        });
      } catch (notifyErr) {
        console.error('Notify admins (booking) error:', notifyErr);
      }

      Alert.alert('Success', 'Your viewing request has been submitted! Our team will review it shortly.');
      setBookingModalVisible(false);
      setBookingDate('');
      setBookingTime('');
      setNotes('');
    } catch (err: any) {
      console.error('Booking submission error:', err);
      Alert.alert('Error', err.message || 'Failed to submit booking request.');
    } finally {
      setSubmittingBooking(false);
    }
  };

  const handlePurchaseSubmit = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to submit a purchase.');
      return;
    }
    if (!selectedProperty) return;

    const parsedAmount = parseFloat(amount);
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive amount.');
      return;
    }
    if (!refCode.trim()) {
      Alert.alert('Validation Error', 'Please enter your payment reference code.');
      return;
    }

    try {
      setSubmittingPurchase(true);
      const result = await submitPropertyPurchase({
        buyerId: user.id,
        propertyId: selectedProperty.id,
        amount: parsedAmount,
        paymentMethod,
        referenceCode: refCode,
        proof,
      });

      await log({
        action: 'create',
        entityType: 'purchase',
        entityId: result.id,
        description: `Client submitted ${paymentMethod} purchase proof for ${selectedProperty.title}.`,
      });

      if (user.id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.clientPurchases(user.id) });
      }

      try {
        await notifyAdmins({
          type: 'purchase_update',
          title: 'New Property Purchase',
          body: `${user.fullName || 'A client'} submitted a purchase of ${formatPrice(result.amount)} for ${selectedProperty.title} (ref ${result.reference}).`,
          entityType: 'purchase',
          entityId: result.id,
        });
      } catch (notifyErr) {
        console.error('Notify admins (purchase) error:', notifyErr);
      }

      Alert.alert(
        'Purchase Submitted',
        `Payment of ${formatPrice(result.amount)} (ref ${result.reference}) was submitted. IBSA staff will verify and mark the property sold.`
      );
      closePurchaseModal();
    } catch (err: any) {
      console.error('Purchase submission error:', err);
      Alert.alert('Submission Failed', err.message || 'Failed to submit purchase.');
    } finally {
      setSubmittingPurchase(false);
    }
  };

  const handleDepositSubmit = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to submit a deposit.');
      return;
    }
    if (!selectedProperty) return;
    if (!depositRefCode.trim()) {
      Alert.alert('Validation Error', 'Please enter your payment reference code.');
      return;
    }

    const expected = depositAmountFromRent(selectedProperty.price);
    try {
      setSubmittingDeposit(true);

      let linkedBookingId: string | null = null;
      const { data: existingBooking } = await supabase
        .from('bookings')
        .select('id')
        .eq('client_id', user.id)
        .eq('property_id', selectedProperty.id)
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedBookingId = existingBooking?.id ?? null;

      const result = await submitDepositPayment({
        clientId: user.id,
        propertyId: selectedProperty.id,
        amount: expected,
        paymentMethod: depositPaymentMethod,
        referenceCode: depositRefCode,
        bookingId: linkedBookingId,
        proof: depositProof,
      });

      await log({
        action: 'create',
        entityType: 'deposit',
        entityId: result.id,
        description: `Client submitted ${depositPaymentMethod} booking deposit for ${selectedProperty.title}.`,
      });

      if (user.id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.clientDeposits(user.id) });
      }

      try {
        await notifyAdmins({
          type: 'deposit_update',
          title: 'New Booking Deposit',
          body: `${user.fullName || 'A client'} submitted a deposit of ${formatPrice(result.amount)} for ${selectedProperty.title} (ref ${result.reference}).`,
          entityType: 'deposit',
          entityId: result.id,
        });
      } catch (notifyErr) {
        console.error('Notify admins (deposit) error:', notifyErr);
      }

      Alert.alert(
        'Deposit Submitted',
        `Security deposit of ${formatPrice(result.amount)} (ref ${result.reference}) was submitted. Staff will verify and reserve the property. Full rent is still due when you occupy.`
      );
      closeDepositModal();
    } catch (err: any) {
      console.error('Deposit submission error:', err);
      Alert.alert('Submission Failed', err.message || 'Failed to submit deposit.');
    } finally {
      setSubmittingDeposit(false);
    }
  };

  const openBookingModal = (property: BrowseProperty) => {
    setSelectedProperty(property);
    setBookingModalVisible(true);
  };

  const openPurchaseOrDeposit = (property: BrowseProperty) => {
    setSelectedProperty(property);
    if (property.type === 'sale') {
      setAmount(String(property.price));
      setRefCode(generatePurchaseReference());
      setPurchaseModalVisible(true);
    } else {
      setDepositRefCode(generateDepositReference());
      setDepositModalVisible(true);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const resumePayment = async (
      propertyId: string,
      action: AuthIntentAction,
    ) => {
      const resumeKey = `${action}:${propertyId}`;
      if (resumeHandledRef.current === resumeKey) return;

      try {
        const data = await fetchAvailablePropertyById(propertyId);
        if (cancelled) return;

        resumeHandledRef.current = resumeKey;
        router.setParams({ action: undefined, propertyId: undefined });

        if (!data) {
          await clearAuthIntent();
          setPaymentResumeHold(false);
          Alert.alert(
            'Property unavailable',
            'That listing is no longer available. Browse other properties to continue.'
          );
          if (role === 'tenant') {
            router.replace('/(tenant)/dashboard');
          }
          return;
        }

        // Hold portal in-memory; clear persisted intent so leftovers cannot pin tenants.
        setPaymentResumeHold(true);
        await clearAuthIntent();
        resumedPaymentRef.current = true;
        openPurchaseOrDeposit(data as BrowseProperty);
      } catch (err: any) {
        if (cancelled) return;
        resumeHandledRef.current = resumeKey;
        await clearAuthIntent();
        setPaymentResumeHold(false);
        router.setParams({ action: undefined, propertyId: undefined });
        Alert.alert('Error', err.message || 'Could not resume your payment.');
        if (role === 'tenant') {
          router.replace('/(tenant)/dashboard');
        }
      }
    };

    (async () => {
      const paramPropertyId =
        typeof resumePropertyId === 'string' ? resumePropertyId : undefined;
      const paramAction =
        resumeAction === 'deposit' || resumeAction === 'purchase'
          ? resumeAction
          : undefined;

      if (paramPropertyId && paramAction) {
        await resumePayment(paramPropertyId, paramAction);
        return;
      }

      // Fallback when Expo Router drops tab params after auth / approval.
      const intent = await getAuthIntent();
      if (cancelled || !intent) return;
      await resumePayment(intent.propertyId, intent.action);
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeAction, resumePropertyId, router, role]);

  const handlePickProofImage = async () => {
    try {
      const images = await pickImages(false);
      if (!images.length) return;
      setProof(images[0]);
      setProofPreviewUri(images[0].uri);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick image.');
    }
  };

  const handlePickProofDoc = async () => {
    try {
      const doc = await pickDocument();
      if (!doc) return;
      setProof(doc);
      setProofPreviewUri(doc.mimeType.startsWith('image/') ? doc.uri : null);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick document.');
    }
  };

  const handlePickDepositProofImage = async () => {
    try {
      const images = await pickImages(false);
      if (!images.length) return;
      setDepositProof(images[0]);
      setDepositProofPreviewUri(images[0].uri);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick image.');
    }
  };

  const handlePickDepositProofDoc = async () => {
    try {
      const doc = await pickDocument();
      if (!doc) return;
      setDepositProof(doc);
      setDepositProofPreviewUri(doc.mimeType.startsWith('image/') ? doc.uri : null);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick document.');
    }
  };

  const methodHint =
    paymentMethod === 'mpesa'
      ? 'Pay via M-Pesa (Paybill/Till), then enter the confirmation code. Optionally attach a screenshot.'
      : paymentMethod === 'bank'
        ? 'Transfer to the IBSA bank account, then enter the bank slip or transfer reference. Attach a slip if you have one.'
        : 'After paying cash to an authorized collector, enter the receipt number and attach a photo if available.';

  const depositMethodHint =
    depositPaymentMethod === 'mpesa'
      ? 'Pay the security deposit via M-Pesa, then enter the confirmation code. Optionally attach a screenshot.'
      : depositPaymentMethod === 'bank'
        ? 'Transfer the security deposit, then enter the bank reference. Attach a slip if you have one.'
        : 'After paying the deposit in cash, enter the receipt number and attach a photo if available.';

  return (
    <View style={styles.container}>
      <PropertyBrowseList
        allowedCategories={['Commercial', 'Land']}
        onAction={openPurchaseOrDeposit}
        onSecondaryAction={openBookingModal}
      />

      <Modal
        animationType="slide"
        transparent={true}
        visible={bookingModalVisible}
        onRequestClose={() => setBookingModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Book Viewing</Text>
              <TouchableOpacity onPress={() => setBookingModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedProperty && (
              <View style={styles.modalBody}>
                <Text style={styles.modalPropTitle}>{selectedProperty.title}</Text>
                <Text style={styles.modalPropLoc}>{selectedProperty.location}</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Date</Text>
                  <TouchableOpacity
                    style={styles.datePickerBtn}
                    onPress={() => setDatePickerVisible(true)}
                  >
                    <Text
                      style={[
                        styles.datePickerText,
                        !bookingDate && styles.datePickerPlaceholder,
                      ]}
                    >
                      {bookingDate || 'Tap to select a date'}
                    </Text>
                    <Calendar size={18} color="#38BDF8" />
                  </TouchableOpacity>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Time</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="HH:MM (e.g. 14:00)"
                    placeholderTextColor="#999"
                    value={bookingTime}
                    onChangeText={setBookingTime}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Additional Notes (Optional)</Text>
                  <TextInput
                    style={[styles.modalInput, styles.textArea]}
                    placeholder="Tell us any details or requests..."
                    placeholderTextColor="#999"
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handleBookingSubmit}
                  disabled={submittingBooking}
                >
                  {submittingBooking ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Viewing Request</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={purchaseModalVisible}
        onRequestClose={closePurchaseModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Buy Property</Text>
              <TouchableOpacity onPress={closePurchaseModal}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedProperty ? (
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalPropTitle}>{selectedProperty.title}</Text>
                <Text style={styles.modalPropLoc}>{selectedProperty.location}</Text>
                <Text style={styles.listedPrice}>
                  Listed price: {formatPrice(selectedProperty.price)}
                </Text>
                <Text style={styles.hint}>{methodHint}</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Payment Method</Text>
                  <View style={styles.methodRow}>
                    {PAYMENT_METHODS.map((m) => (
                      <TouchableOpacity
                        key={m.value}
                        style={[
                          styles.methodChip,
                          paymentMethod === m.value && styles.methodChipActive,
                        ]}
                        onPress={() => setPaymentMethod(m.value)}
                      >
                        <Text
                          style={[
                            styles.methodChipText,
                            paymentMethod === m.value && styles.methodChipTextActive,
                          ]}
                        >
                          {m.value.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Amount (KES)</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Amount paid"
                    placeholderTextColor="#999"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.label, styles.labelInRow]}>Payment Reference</Text>
                    <TouchableOpacity onPress={() => setRefCode(generatePurchaseReference())}>
                      <Text style={styles.generateBtnText}>Generate</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="M-Pesa / bank / receipt reference"
                    placeholderTextColor="#999"
                    value={refCode}
                    onChangeText={setRefCode}
                    autoCapitalize="characters"
                  />
                  <Text style={styles.refHint}>
                    Auto-filled for demo — replace with your real M-Pesa code if you paid outside the
                    app.
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Proof (optional)</Text>
                  <View style={styles.proofRow}>
                    <TouchableOpacity style={styles.proofBtn} onPress={handlePickProofImage}>
                      <Paperclip size={14} color="#0F172A" />
                      <Text style={styles.proofBtnText}>Image</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.proofBtn} onPress={handlePickProofDoc}>
                      <Paperclip size={14} color="#0F172A" />
                      <Text style={styles.proofBtnText}>Document</Text>
                    </TouchableOpacity>
                    {proof ? (
                      <TouchableOpacity
                        onPress={() => {
                          setProof(null);
                          setProofPreviewUri(null);
                        }}
                      >
                        <Text style={styles.clearProof}>Clear</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {proofPreviewUri ? (
                    <Image source={{ uri: proofPreviewUri }} style={styles.proofPreview} />
                  ) : proof && 'name' in proof ? (
                    <Text style={styles.proofName}>{proof.name}</Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handlePurchaseSubmit}
                  disabled={submittingPurchase}
                >
                  {submittingPurchase ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Purchase Proof</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={depositModalVisible}
        onRequestClose={closeDepositModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pay Security Deposit</Text>
              <TouchableOpacity onPress={closeDepositModal}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedProperty ? (
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalPropTitle}>{selectedProperty.title}</Text>
                <Text style={styles.modalPropLoc}>{selectedProperty.location}</Text>
                <Text style={styles.listedPrice}>
                  Monthly rent: {formatPrice(selectedProperty.price)}
                </Text>
                <Text style={styles.listedPrice}>
                  Deposit (½ month): {formatPrice(depositAmountFromRent(selectedProperty.price))}
                </Text>
                <Text style={styles.hint}>
                  This deposit reserves the property and is held for damage. You still pay full
                  rent when you occupy. It is refunded on exit if there is no damage.
                </Text>
                <Text style={styles.hint}>{depositMethodHint}</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Payment Method</Text>
                  <View style={styles.methodRow}>
                    {PAYMENT_METHODS.map((m) => (
                      <TouchableOpacity
                        key={m.value}
                        style={[
                          styles.methodChip,
                          depositPaymentMethod === m.value && styles.methodChipActive,
                        ]}
                        onPress={() => setDepositPaymentMethod(m.value)}
                      >
                        <Text
                          style={[
                            styles.methodChipText,
                            depositPaymentMethod === m.value && styles.methodChipTextActive,
                          ]}
                        >
                          {m.value.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Amount (KES)</Text>
                  <TextInput
                    style={[styles.modalInput, styles.readOnlyInput]}
                    value={String(depositAmountFromRent(selectedProperty.price))}
                    editable={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.label, styles.labelInRow]}>Payment Reference</Text>
                    <TouchableOpacity onPress={() => setDepositRefCode(generateDepositReference())}>
                      <Text style={styles.generateBtnText}>Generate</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="M-Pesa / bank / receipt reference"
                    placeholderTextColor="#999"
                    value={depositRefCode}
                    onChangeText={setDepositRefCode}
                    autoCapitalize="characters"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Proof (optional)</Text>
                  <View style={styles.proofRow}>
                    <TouchableOpacity style={styles.proofBtn} onPress={handlePickDepositProofImage}>
                      <Paperclip size={14} color="#0F172A" />
                      <Text style={styles.proofBtnText}>Image</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.proofBtn} onPress={handlePickDepositProofDoc}>
                      <Paperclip size={14} color="#0F172A" />
                      <Text style={styles.proofBtnText}>Document</Text>
                    </TouchableOpacity>
                    {depositProof ? (
                      <TouchableOpacity
                        onPress={() => {
                          setDepositProof(null);
                          setDepositProofPreviewUri(null);
                        }}
                      >
                        <Text style={styles.clearProof}>Clear</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {depositProofPreviewUri ? (
                    <Image source={{ uri: depositProofPreviewUri }} style={styles.proofPreview} />
                  ) : depositProof && 'name' in depositProof ? (
                    <Text style={styles.proofName}>{depositProof.name}</Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handleDepositSubmit}
                  disabled={submittingDeposit}
                >
                  {submittingDeposit ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Deposit Proof</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DatePickerModal
        visible={datePickerVisible}
        onClose={() => setDatePickerVisible(false)}
        value={bookingDate}
        onChange={setBookingDate}
        title="Select Viewing Date"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalScroll: {
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalBody: {
    marginTop: 6,
  },
  modalPropTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  modalPropLoc: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 8,
  },
  listedPrice: {
    color: '#F8FAFC',
    fontWeight: '600',
    marginBottom: 8,
  },
  hint: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  labelInRow: {
    marginBottom: 0,
  },
  generateBtnText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  refHint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  inputGroup: {
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 15,
  },
  readOnlyInput: {
    opacity: 0.9,
    color: '#38BDF8',
    fontWeight: '600',
  },
  datePickerBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerText: {
    color: '#F8FAFC',
    fontSize: 15,
  },
  datePickerPlaceholder: {
    color: '#999',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  methodChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
  },
  methodChipActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  methodChipText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 12,
  },
  methodChipTextActive: {
    color: '#38BDF8',
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  proofBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proofBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 13,
  },
  clearProof: {
    color: '#EF4444',
    fontWeight: '600',
  },
  proofPreview: {
    marginTop: 10,
    width: '100%',
    height: 140,
    borderRadius: 8,
  },
  proofName: {
    marginTop: 8,
    color: '#94A3B8',
    fontSize: 13,
  },
  modalSubmitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 24,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  modalSubmitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
