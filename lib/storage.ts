import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import { Linking } from 'react-native';
import { supabase } from './supabase';

export type PickedImage = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
};

export type PickedDocument = {
  uri: string;
  name: string;
  mimeType: string;
};

export async function pickImages(allowsMultipleSelection = false): Promise<PickedImage[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Keep payloads modest — large ArrayBuffers often fail with
    // StorageUnknownError ("Network request failed") on device.
    quality: 0.7,
    allowsMultipleSelection,
    selectionLimit: allowsMultipleSelection ? 5 : 1,
    base64: true,
  });

  if (result.canceled) {
    return [];
  }

  return result.assets.map((asset) => ({
    uri: asset.uri,
    base64: asset.base64,
    mimeType: asset.mimeType,
  }));
}

function guessContentType(uri: string): string {
  const clean = uri.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.heic') || clean.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

async function toArrayBuffer(source: string | PickedImage): Promise<{
  arrayBuffer: ArrayBuffer;
  contentType: string;
}> {
  if (typeof source !== 'string' && source.base64) {
    const buf = Buffer.from(source.base64, 'base64');
    return {
      arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      contentType: source.mimeType || guessContentType(source.uri),
    };
  }

  const uri = typeof source === 'string' ? source : source.uri;
  const file = new File(uri);
  const arrayBuffer = await file.arrayBuffer();
  return {
    arrayBuffer,
    contentType: (typeof source !== 'string' && source.mimeType) || guessContentType(uri),
  };
}

export async function uploadImage(
  bucket: string,
  path: string,
  source: string | PickedImage,
): Promise<string> {
  // React Native: Blob / File / FormData uploads fail with StorageUnknownError
  // ("Network request failed"). Prefer base64 from the picker decoded to ArrayBuffer.
  const { arrayBuffer, contentType } = await toArrayBuffer(source);

  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
    upsert: true,
    contentType,
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Pick a PDF or image contract from the device. */
export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || 'contract.pdf',
    mimeType: asset.mimeType || 'application/pdf',
  };
}

/** Upload a contract PDF/image to the contracts bucket; returns public URL. */
export async function uploadContract(
  path: string,
  doc: PickedDocument,
): Promise<string> {
  const file = new File(doc.uri);
  const arrayBuffer = await file.arrayBuffer();
  const { error } = await supabase.storage.from('contracts').upload(path, arrayBuffer, {
    upsert: true,
    contentType: doc.mimeType,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('contracts').getPublicUrl(path);
  return data.publicUrl;
}

/** Upload payment proof (image or PDF) under `{userId}/...`. */
export async function uploadPaymentProof(
  userId: string,
  source: PickedImage | PickedDocument,
): Promise<string> {
  const stamp = Date.now();
  if ('name' in source) {
    const doc = source;
    const safeName = doc.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${stamp}_${safeName}`;
    const file = new File(doc.uri);
    const arrayBuffer = await file.arrayBuffer();
    const { error } = await supabase.storage.from('payment-proofs').upload(path, arrayBuffer, {
      upsert: true,
      contentType: doc.mimeType,
    });
    if (error) throw error;
    const { data } = supabase.storage.from('payment-proofs').getPublicUrl(path);
    return data.publicUrl;
  }

  const img = source;
  const ext = (img.mimeType || guessContentType(img.uri)).split('/')[1] || 'jpg';
  const path = `${userId}/${stamp}_proof.${ext === 'jpeg' ? 'jpg' : ext}`;
  return uploadImage('payment-proofs', path, img);
}

/** Upload a lease vault document (PDF/image) to lease-documents bucket. */
export async function uploadLeaseDocumentFile(
  path: string,
  doc: PickedDocument,
): Promise<string> {
  const file = new File(doc.uri);
  const arrayBuffer = await file.arrayBuffer();
  const { error } = await supabase.storage.from('lease-documents').upload(path, arrayBuffer, {
    upsert: true,
    contentType: doc.mimeType,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('lease-documents').getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a sale purchase document (PDF/image) to purchase-documents bucket (private). */
export async function uploadPurchaseDocumentFile(
  path: string,
  doc: PickedDocument,
): Promise<string> {
  const file = new File(doc.uri);
  const arrayBuffer = await file.arrayBuffer();
  const { error } = await supabase.storage.from('purchase-documents').upload(path, arrayBuffer, {
    upsert: true,
    contentType: doc.mimeType,
  });
  if (error) throw error;
  // Store the object path — bucket is private; open via createSignedUrl.
  return path;
}

/** Resolve a storage object path from a stored path or legacy public URL. */
export function storageObjectPath(bucket: string, pathOrUrl: string): string {
  const publicMarker = `/object/public/${bucket}/`;
  const signMarker = `/object/sign/${bucket}/`;
  if (pathOrUrl.includes(publicMarker)) {
    return decodeURIComponent(pathOrUrl.split(publicMarker)[1]?.split('?')[0] || pathOrUrl);
  }
  if (pathOrUrl.includes(signMarker)) {
    return decodeURIComponent(pathOrUrl.split(signMarker)[1]?.split('?')[0] || pathOrUrl);
  }
  return pathOrUrl.replace(/^\//, '');
}

/** Best-effort remove of a payment-proofs object after a failed DB insert. */
export async function deletePaymentProof(pathOrUrl: string): Promise<void> {
  const path = storageObjectPath('payment-proofs', pathOrUrl);
  if (!path) return;
  const { error } = await supabase.storage.from('payment-proofs').remove([path]);
  if (error) {
    console.warn('Failed to clean up orphan payment proof:', error.message);
  }
}

/** Best-effort remove of a purchase-documents object after a failed DB insert. */
export async function deletePurchaseDocumentFile(pathOrUrl: string): Promise<void> {
  const path = storageObjectPath('purchase-documents', pathOrUrl);
  if (!path) return;
  const { error } = await supabase.storage.from('purchase-documents').remove([path]);
  if (error) {
    console.warn('Failed to clean up orphan purchase document:', error.message);
  }
}

/** Create a short-lived signed URL for a private storage object. */
export async function createSignedStorageUrl(
  bucket: string,
  pathOrUrl: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const path = storageObjectPath(bucket, pathOrUrl);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Upload a generated PDF receipt ArrayBuffer. */
export async function uploadPaymentReceipt(
  path: string,
  arrayBuffer: ArrayBuffer,
): Promise<string> {
  const { error } = await supabase.storage.from('payment-receipts').upload(path, arrayBuffer, {
    upsert: true,
    contentType: 'application/pdf',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('payment-receipts').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Buckets that are private (see migration 20260741000000_tighten_rls_and_storage).
 * Their stored getPublicUrl() links no longer work on their own, so the app must
 * exchange them for a short-lived signed URL before opening or displaying them.
 */
export const PRIVATE_BUCKETS = [
  'contracts',
  'lease-documents',
  'payment-proofs',
  'payment-receipts',
  'maintenance-images',
  'purchase-documents',
] as const;

const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

/** Split a Supabase Storage URL into bucket + object path, or null if it is not one. */
export function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const match = STORAGE_URL_RE.exec(url);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

/**
 * Turn a stored file URL into something the device can open.
 * - Files in a private bucket → fresh signed URL (requires the caller to pass RLS).
 * - Anything else (public buckets, external links typed by a landlord) → unchanged.
 */
export async function resolveStorageUrl(
  url: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!url) return null;
  const parsed = parseStorageUrl(url);
  if (!parsed || !(PRIVATE_BUCKETS as readonly string[]).includes(parsed.bucket)) return url;
  return createSignedStorageUrl(parsed.bucket, parsed.path, expiresInSeconds);
}

/** Open a stored file URL (signing it first when it lives in a private bucket). */
export async function openStorageUrl(url: string | null | undefined): Promise<void> {
  const resolved = await resolveStorageUrl(url);
  if (!resolved) return;
  await Linking.openURL(resolved);
}
