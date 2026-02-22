/**
 * offlineStore.ts — IndexedDB-backed offline storage for BrewHub ops.
 *
 * Provides:
 * 1. Menu cache — persist last-known menu so POS works offline
 * 2. Offline order queue — orders created when offline, synced on reconnect
 * 3. KDS snapshot — last-fetched KDS orders for display during outage
 *
 * Uses raw IndexedDB (no library) to keep bundle size at zero.
 */

const DB_NAME = "brewhub-offline";
const DB_VERSION = 1;

// ── Store names ─────────────────────────────────────────────────
const MENU_STORE = "menu";
const ORDER_QUEUE = "orderQueue";
const KDS_SNAPSHOT = "kdsSnapshot";
const KV_STORE = "kv"; // generic key-value for timestamps, etc.

// ── Types ───────────────────────────────────────────────────────
export interface CachedMenuItem {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
}

export interface OfflineOrder {
  id: string; // client-generated UUID
  items: { product_id: string; name: string; quantity: number; price_cents: number }[];
  total_cents: number;
  customer_name?: string;
  payment_method: "cash" | "pending"; // only cash works offline
  created_at: string; // ISO timestamp
  synced: boolean;
}

export interface KDSOrderSnapshot {
  id: string;
  status: string;
  customer_name: string | null;
  created_at: string;
  coffee_orders?: {
    id: string;
    drink_name: string;
    customizations?: Record<string, string> | string | null;
  }[];
}

// ── Open database ───────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MENU_STORE)) {
        db.createObjectStore(MENU_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ORDER_QUEUE)) {
        db.createObjectStore(ORDER_QUEUE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KDS_SNAPSHOT)) {
        db.createObjectStore(KDS_SNAPSHOT, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Generic helpers ─────────────────────────────────────────────
async function putAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  for (const item of items) {
    store.put(item);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { db.close(); resolve(request.result as T[]); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function putKV(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KV_STORE, "readwrite");
  tx.objectStore(KV_STORE).put({ key, value });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getKV<T = unknown>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction(KV_STORE, "readonly");
  const request = tx.objectStore(KV_STORE).get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      db.close();
      resolve(request.result?.value ?? null);
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

// ── Menu Cache ──────────────────────────────────────────────────
export async function cacheMenu(items: CachedMenuItem[]): Promise<void> {
  await clearStore(MENU_STORE);
  await putAll(MENU_STORE, items);
  await putKV("menu_cached_at", new Date().toISOString());
}

export async function getCachedMenu(): Promise<CachedMenuItem[]> {
  return getAll<CachedMenuItem>(MENU_STORE);
}

export async function getMenuCacheAge(): Promise<string | null> {
  return getKV<string>("menu_cached_at");
}

// ── Offline Order Queue ─────────────────────────────────────────
export async function queueOfflineOrder(order: OfflineOrder): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(ORDER_QUEUE, "readwrite");
  tx.objectStore(ORDER_QUEUE).put(order);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getOfflineOrders(): Promise<OfflineOrder[]> {
  return getAll<OfflineOrder>(ORDER_QUEUE);
}

export async function getUnsyncedOrders(): Promise<OfflineOrder[]> {
  const all = await getAll<OfflineOrder>(ORDER_QUEUE);
  return all.filter((o) => !o.synced);
}

export async function markOrderSynced(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(ORDER_QUEUE, "readwrite");
  const store = tx.objectStore(ORDER_QUEUE);
  const request = store.get(id);
  request.onsuccess = () => {
    if (request.result) {
      store.put({ ...request.result, synced: true });
    }
  };
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function clearSyncedOrders(): Promise<void> {
  const all = await getAll<OfflineOrder>(ORDER_QUEUE);
  const unsynced = all.filter((o) => !o.synced);
  await clearStore(ORDER_QUEUE);
  if (unsynced.length > 0) {
    await putAll(ORDER_QUEUE, unsynced);
  }
}

// ── KDS Snapshot ────────────────────────────────────────────────
export async function saveKDSSnapshot(orders: KDSOrderSnapshot[]): Promise<void> {
  await clearStore(KDS_SNAPSHOT);
  await putAll(KDS_SNAPSHOT, orders);
  await putKV("kds_snapshot_at", new Date().toISOString());
}

export async function getKDSSnapshot(): Promise<KDSOrderSnapshot[]> {
  return getAll<KDSOrderSnapshot>(KDS_SNAPSHOT);
}

export async function getKDSSnapshotAge(): Promise<string | null> {
  return getKV<string>("kds_snapshot_at");
}
