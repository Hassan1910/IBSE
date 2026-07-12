import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import { supabase } from './supabase';

export type PickedImage = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
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
