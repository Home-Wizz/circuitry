/**
 * IndexedDB storage adapter for Zustand persistence
 * Provides a storage interface compatible with Zustand's persist middleware
 */

import type { StateStorage, StorageValue } from 'zustand/middleware';
import type { PersistedFlowState } from '@/store/flow-store';

/**
 * IndexedDB storage implementation for Zustand persistence
 */
export class IndexedDBStorage implements StateStorage<Promise<void>> {
  private dbName: string;
  private storeName: string;
  private dbVersion: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string, storeName: string, dbVersion = 1) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;
  }

  /**
   * Initialize the IndexedDB database
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);
        reject(new Error('Failed to open IndexedDB database'));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get an item from IndexedDB
   */
  async getItem(name: string): Promise<string | null> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(name);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ?? null);
        };

        request.onerror = () => {
          reject(new Error('Failed to get item from IndexedDB'));
        };
      });
    } catch (error) {
      console.error('IndexedDB getItem error:', error);
      return null;
    }
  }

  /**
   * Set an item in IndexedDB
   */
  async setItem(name: string, value: string): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value, name);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to set item in IndexedDB'));
      });
    } catch (error) {
      console.error('IndexedDB setItem error:', error);
      throw error;
    }
  }

  /**
   * Remove an item from IndexedDB
   */
  async removeItem(name: string): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(name);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to remove item from IndexedDB'));
      });
    } catch (error) {
      console.error('IndexedDB removeItem error:', error);
      throw error;
    }
  }

  /**
   * Create a JSON storage adapter for Zustand
   */
  static createJSONStorage<S>(
    dbName: string,
    storeName: string
  ): {
    getItem: (name: string) => Promise<StorageValue<S> | null>;
    setItem: (name: string, value: StorageValue<S>) => Promise<void>;
    removeItem: (name: string) => Promise<void>;
  } {
    // In Node (test) environments IndexedDB is not available. Fall back to an
    // in-memory Map implementation to allow tests to run without a browser.
    if (!('indexedDB' in globalThis)) {
      const mem = new Map<string, string>();
      return {
        getItem: async (name: string) => {
          const v = mem.get(name) ?? null;
          return v ? (JSON.parse(v) as StorageValue<S>) : null;
        },
        setItem: async (name: string, value: StorageValue<S>) => {
          mem.set(name, JSON.stringify(value));
        },
        removeItem: async (name: string) => {
          mem.delete(name);
        },
      };
    }

    const storage = new IndexedDBStorage(dbName, storeName);

    return {
      getItem: async (name: string) => {
        const value = await storage.getItem(name);
        return value ? JSON.parse(value) : null;
      },
      setItem: async (name: string, value: StorageValue<S>) => {
        await storage.setItem(name, JSON.stringify(value));
      },
      removeItem: async (name: string) => {
        await storage.removeItem(name);
      },
    };
  }
}

interface DraftStorage<V> {
  getItem: (name: string) => Promise<V | null>;
  setItem: (name: string, value: V) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
}

/**
 * `storage` with its writes coalesced: the store saves the draft on every
 * change (every frame of a drag, every key), so a write waits until the
 * changes have paused for `delayMs` and then writes only the latest draft.
 * It is written at once when the page is hidden or closed, a read sees a
 * draft still waiting, and a failed write is logged (the draft is a
 * convenience; it used to be an unhandled rejection). Bug #208.
 */
export function coalescedWrites<V>(storage: DraftStorage<V>, delayMs: number): DraftStorage<V> {
  const waiting = new Map<string, V>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const drafts = [...waiting];
    waiting.clear();
    for (const [name, value] of drafts) {
      try {
        await storage.setItem(name, value);
      } catch (error) {
        console.warn('Circuitry: could not keep the draft in the browser:', error);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }

  return {
    getItem: async (name) => (waiting.has(name) ? (waiting.get(name) as V) : storage.getItem(name)),
    setItem: async (name, value) => {
      waiting.set(name, value);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    removeItem: async (name) => {
      waiting.delete(name);
      await storage.removeItem(name);
    },
  };
}

/** How long the draft waits for the changes to pause before it is written. */
const DRAFT_WRITE_DELAY_MS = 400;

/**
 * Default IndexedDB storage instance for Circuitry.
 *
 * Renamed from the FLODE-era 'flode-flow-storage' as part of
 * the rebrand. This only holds in-progress draft/UI state (unsaved canvas
 * edits), not saved automations, so unlike the YAML `_circuitry_metadata`
 * key there's no round-trip compat concern here — worst case an existing
 * user's unsaved draft resets once under the new key.
 */
export const circuitryIndexedDBStorage = coalescedWrites(
  IndexedDBStorage.createJSONStorage<PersistedFlowState>('circuitry-flow-storage', 'flow-store'),
  DRAFT_WRITE_DELAY_MS
);
