import { useState, useEffect, useCallback, useMemo } from "react";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import { getWeekId } from "../lib/utils";
import type { Receipt, SpendingSummary } from "../types";

interface ReceiptIndex {
  id: string;
  date: string;
  store?: string;
  total?: number;
}

export function useReceipts() {
  const [receipts, setReceipts] = useState<ReceiptIndex[]>(
    () => getLocal<ReceiptIndex[]>(CACHE_KEYS.RECEIPTS) ?? []
  );
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScannedReceipt, setLastScannedReceipt] = useState<Receipt | null>(null);

  // Fetch receipt index from API on mount
  useEffect(() => {
    const token = localStorage.getItem("whisk_token");
    if (!token) return;

    fetch("/api/shopping/receipt-index", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data && Array.isArray(data)) {
          setReceipts(data as ReceiptIndex[]);
          setLocal(CACHE_KEYS.RECEIPTS, data);
        }
      })
      .catch(() => {});
  }, []);

  const scanReceipt = useCallback(async (photo: File): Promise<Receipt | null> => {
    setIsScanning(true);
    setScanError(null);
    setLastScannedReceipt(null);

    try {
      const formData = new FormData();
      formData.append("photo", photo);

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/shopping/receipt", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Scan failed" })) as { error?: string };
        throw new Error(data.error ?? `Scan failed: ${res.status}`);
      }

      const receipt = (await res.json()) as Receipt;
      setLastScannedReceipt(receipt);

      // Update local receipt index
      const entry: ReceiptIndex = {
        id: receipt.id,
        date: receipt.date,
        store: receipt.store,
        total: receipt.total,
      };
      const updated = [entry, ...receipts].slice(0, 100);
      setReceipts(updated);
      setLocal(CACHE_KEYS.RECEIPTS, updated);

      return receipt;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to scan receipt";
      setScanError(message);
      return null;
    } finally {
      setIsScanning(false);
    }
  }, [receipts]);

  const getSpendingSummary = useCallback((weekId?: string): SpendingSummary | null => {
    const targetWeekId = weekId ?? getWeekId(new Date());

    // Check cache first
    const cached = getLocal<SpendingSummary>(CACHE_KEYS.SPENDING(targetWeekId));
    if (cached) return cached;

    // Compute from receipt index
    // To compute properly we'd need full receipt data, but we can approximate from index
    const weekReceipts = receipts.filter((r) => {
      const receiptWeekId = getWeekId(new Date(r.date + "T00:00:00"));
      return receiptWeekId === targetWeekId;
    });

    if (weekReceipts.length === 0) return null;

    const byStore: Record<string, number> = {};
    let total = 0;
    for (const r of weekReceipts) {
      if (r.total) {
        total += r.total;
        if (r.store) {
          byStore[r.store] = (byStore[r.store] ?? 0) + r.total;
        }
      }
    }

    const summary: SpendingSummary = {
      weekOf: targetWeekId,
      total,
      byStore,
      byCategory: {},
      itemCount: weekReceipts.length,
    };

    setLocal(CACHE_KEYS.SPENDING(targetWeekId), summary);
    return summary;
  }, [receipts]);

  const getSpendingHistory = useCallback((weeks: number): SpendingSummary[] => {
    const history: SpendingSummary[] = [];
    const now = new Date();
    for (let i = 0; i < weeks; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const wId = getWeekId(d);
      const summary = getSpendingSummary(wId);
      if (summary && summary.total > 0) {
        history.push(summary);
      }
    }
    return history;
  }, [getSpendingSummary]);

  const currentWeekSpending = useMemo(() => {
    return getSpendingSummary();
  }, [getSpendingSummary]);

  const lastWeekSpending = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return getSpendingSummary(getWeekId(d));
  }, [getSpendingSummary]);

  const spendingTrend = useMemo(() => {
    if (!currentWeekSpending || !lastWeekSpending) return null;
    const diff = currentWeekSpending.total - lastWeekSpending.total;
    return {
      amount: Math.abs(diff),
      direction: diff > 0 ? "up" as const : diff < 0 ? "down" as const : "flat" as const,
    };
  }, [currentWeekSpending, lastWeekSpending]);

  return {
    receipts,
    isScanning,
    scanError,
    lastScannedReceipt,
    scanReceipt,
    getSpendingSummary,
    getSpendingHistory,
    currentWeekSpending,
    spendingTrend,
    clearScanError: () => setScanError(null),
    clearLastScanned: () => setLastScannedReceipt(null),
  };
}
