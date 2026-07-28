import * as SecureStore from 'expo-secure-store';

/** Clerk usernames allow letters, digits, '-', '_'; derive from a display name or email. */
export function deriveClerkUsername(displayName: string, email: string): string {
  let username = displayName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  if (username.length < 4) {
    username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }
  if (username.length < 4) {
    username = `user_${Date.now().toString(36)}`;
  }
  return username.slice(0, 64);
}

export function withUsernameSuffix(username: string): string {
  return `${username.slice(0, 59)}_${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface TokenCache {
  getToken: (key: string) => Promise<string | null>;
  saveToken: (key: string, value: string) => Promise<void>;
  clearToken?: (key: string) => Promise<void>;
}

export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      const item = await SecureStore.getItemAsync(key);
      return item;
    } catch (error) {
      console.error('Clerk SecureStore getToken error: ', error);
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.error('Clerk SecureStore saveToken error: ', err);
    }
  },
  async clearToken(key: string) {
    try {
      return SecureStore.deleteItemAsync(key);
    } catch (err) {
      console.error('Clerk SecureStore clearToken error: ', err);
    }
  }
};
