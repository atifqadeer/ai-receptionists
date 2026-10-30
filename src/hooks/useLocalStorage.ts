import { useState, useEffect } from 'react';

/**
 * Custom hook for persisting state to localStorage
 * Automatically saves on change and loads on init
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') {
        return initialValue;
      }
      
      const item = window.localStorage.getItem(key);
      // Parse stored json or return initialValue
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      // If error also return initialValue
      console.error(`Error loading ${key} from localStorage:`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists to localStorage
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      // Save state
      setStoredValue(valueToStore);
      
      // Save to localStorage
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.error(`Error saving ${key} to localStorage:`, error);
    }
  };

  return [storedValue, setValue];
}

/**
 * Hook to clear all localStorage data
 */
export function useClearStorage() {
  const clearAll = () => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
      window.location.reload();
    }
  };
  
  const clearKey = (key: string) => {
    if (typeof window !== 'undefined') {
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
