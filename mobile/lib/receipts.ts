// Reports submitted from this phone. The receipt token is the only key to a report's photo and status, so it is
// kept in the Keychain/Keystore; the list beside it holds just enough to draw "My reports" offline.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { HazardCategory, ReportDetail, ReportStatus } from './types';

export interface Receipt {
  id: string;
  reference: string;
  createdAt: string;
  status: ReportStatus;
  category: HazardCategory | null;
  summary: string | null;
  locationNote: string | null;
}

const LIST_KEY = 'mtaasense.receipts.v1';
const tokenKey = (id: string) => `receipt.${id}`;

let receipts: Receipt[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function persist() {
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(receipts));
}

export function loadReceipts(): Promise<void> {
  loading ??= AsyncStorage.getItem(LIST_KEY)
    .then((raw) => {
      // Anything added before the stored list finished loading is kept in front of it.
      const stored = raw ? (JSON.parse(raw) as Receipt[]) : [];
      receipts = [...receipts, ...stored.filter((s) => !receipts.some((r) => r.id === s.id))];
    })
    .catch(() => undefined)
    .finally(() => {
      loaded = true;
      emit();
    });
  return loading;
}

export async function addReceipt(receipt: Receipt, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(receipt.id), token);
  receipts = [receipt, ...receipts.filter((r) => r.id !== receipt.id)];
  emit();
  await persist();
}

/** Refresh the cached status from a freshly loaded report. */
export async function syncReceipt(report: ReportDetail): Promise<void> {
  const current = receipts.find((r) => r.id === report.id);
  if (!current) return;
  const next: Receipt = {
    ...current,
    status: report.status,
    category: report.hazard_category,
    summary: report.ai_summary,
    locationNote: report.location_note,
  };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  receipts = receipts.map((r) => (r.id === report.id ? next : r));
  emit();
  await persist();
}

export async function removeReceipt(id: string): Promise<void> {
  receipts = receipts.filter((r) => r.id !== id);
  emit();
  await persist();
  await SecureStore.deleteItemAsync(tokenKey(id));
}

export function receiptToken(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadReceipts();
  return () => listeners.delete(listener);
}

export function useReceipts(): { receipts: Receipt[]; loaded: boolean } {
  const list = useSyncExternalStore(subscribe, () => receipts);
  const isLoaded = useSyncExternalStore(subscribe, () => loaded);
  return { receipts: list, loaded: isLoaded };
}
