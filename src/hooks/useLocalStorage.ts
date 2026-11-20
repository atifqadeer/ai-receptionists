import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../utils/agentApi';

/*
 * App settings, saved in the MySQL database through the backend
 * (/api/store/<key>). The browser keeps a copy in localStorage, so a
 * setting shows at once on load and the app still works while the backend
 * is down; changes made then are sent once it is back.
 *
 * - on first use of a key: the backend's value replaces the browser copy;
 *   if the backend has none yet, the browser copy is uploaded (one-time
 *   move of existing settings into MySQL)
 * - on change: saved in the browser at once, sent to the backend 400 ms
 *   after the last change
 * - components using the same key stay in step with each other
 */

const PUSH_DELAY = 400;
const pulled = new Set<string>();          // keys fetched from the backend this session
const dirty = new Set<string>();           // changed here before the fetch came back
const unsynced = new Map<string, unknown>(); // waiting to be sent
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(v: unknown) => void>>();

const storeUrl = (key: string) => `${API_BASE}/api/store/${encodeURIComponent(key)}`;

function writeLocal(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

function broadcast(key: string, value: unknown) {
  listeners.get(key)?.forEach((fn) => fn(value));
}

async function push(key: string, keepalive = false) {
  if (!unsynced.has(key)) return;
  const value = unsynced.get(key);
  try {
    const res = await fetch(storeUrl(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
      keepalive,
    });
    if (res.ok && unsynced.get(key) === value) unsynced.delete(key);
  } catch {
    /* backend offline: kept in unsynced, sent with the next change */
  }
}

function schedulePush(key: string, value: unknown) {
  unsynced.set(key, value);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); push(key); }, PUSH_DELAY));
}

async function pull(key: string) {
  if (pulled.has(key)) return;
  pulled.add(key);
  try {
    const res = await fetch(storeUrl(key));
    const body = res.ok ? await res.json() : null;
    if (body && body.exists) {
      if (dirty.has(key)) return;            // edited meanwhile: the edit wins and is being sent
      writeLocal(key, body.value);
      broadcast(key, body.value);
    } else if (body) {
      const local = window.localStorage.getItem(key);
      if (local !== null && !unsynced.has(key)) {
        try { schedulePush(key, JSON.parse(local)); } catch { /* unreadable copy: ignore */ }
      }
    } else {
      pulled.delete(key);                     // try again next time
    }
  } catch {
    pulled.delete(key);                       // backend offline: try again on next mount
  }
}

if (typeof window !== 'undefined') {
  // Send pending changes when the page closes.
  window.addEventListener('pagehide', () => {
    for (const key of Array.from(unsynced.keys())) {
      clearTimeout(timers.get(key));
      push(key, true);
    }
  });
}

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') return initialValue;
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error);
      return initialValue;
    }
  });
  const current = useRef(storedValue);
  current.current = storedValue;

  useEffect(() => {
    const listener = (v: unknown) => { current.current = v as T; setStoredValue(v as T); };
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(listener);
    pull(key);
    return () => { listeners.get(key)?.delete(listener); };
  }, [key]);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    const next = value instanceof Function ? value(current.current) : value;
    current.current = next;
    if (!pulled.has(key)) dirty.add(key);
    writeLocal(key, next);
    broadcast(key, next);
    schedulePush(key, next);
  }, [key]);

  return [storedValue, setValue];
}

/**
 * Hook to clear all localStorage data
 */
export function useClearStorage() {
  // Settings live in MySQL too: delete them there as well, or they would
  // be loaded straight back.
  const removeEverywhere = (keys: string[]) =>
    Promise.all(keys.map((k) => fetch(storeUrl(k), { method: 'DELETE' }).catch(() => undefined)));

  const clearAll = async () => {
    if (typeof window !== 'undefined') {
      const keys = Object.keys(localStorage);
      keys.forEach((k) => unsynced.delete(k));
      await removeEverywhere(keys);
      localStorage.clear();
      window.location.reload();
    }
  };

  const clearKey = async (key: string) => {
    if (typeof window !== 'undefined') {
      unsynced.delete(key);
      await removeEverywhere([key]);
      localStorage.removeItem(key);
      window.location.reload();
    }
  };
  
  return { clearAll, clearKey };
}

/**
 * Hook to export/import all localStorage data
 */
export function useStorageExport() {
  const exportData = () => {
    const data: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        data[key] = localStorage.getItem(key);
      }
    }
    return data;
  };
  
  const importData = (data: Record<string, any>) => {
    Object.entries(data).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
    window.location.reload();
  };
  
  const downloadBackup = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-receptionist-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  return { exportData, importData, downloadBackup };
}
