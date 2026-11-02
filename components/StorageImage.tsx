import React, { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { resolveStorageUrl } from '../lib/storage';

type StorageImageProps = Omit<ImageProps, 'source'> & {
  /** The stored URL (e.g. a getPublicUrl link saved in the database). */
  uri: string;
};

/**
 * expo-image wrapper for files that may live in a private Storage bucket.
 * Private-bucket URLs are swapped for a signed URL; public ones are shown as-is.
 * The stored URL is used as the cache key so re-signing does not re-download.
 */
export default function StorageImage({ uri, ...rest }: StorageImageProps) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    resolveStorageUrl(uri)
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch((err) => {
        console.warn('StorageImage: could not sign URL', err);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return <Image {...rest} source={resolved ? { uri: resolved, cacheKey: uri } : null} />;
}
