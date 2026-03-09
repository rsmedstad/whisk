import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import { matchDealsToList, getBestStore } from "../lib/deals";
import type { Deal, DealIndex, ShoppingItem, Store } from "../types";

const FLIPP_REFRESH_KEY = "whisk_flipp_last_refresh";
const FLIPP_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function useDeals() {
  const [dealIndex, setDealIndex] = useState<DealIndex>(
    () => getLocal<DealIndex>(CACHE_KEYS.DEAL_INDEX) ?? { deals: [], lastScanned: {}, updatedAt: "" }
  );
  const [stores, setStores] = useState<Store[]>(
    () => getLocal<Store[]>(CACHE_KEYS.STORES) ?? []
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter out expired deals
  const activeDeals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return dealIndex.deals.filter((d) => d.validTo >= today);
  }, [dealIndex.deals]);

  // Fetch deals and stores on mount
  useEffect(() => {
    api.get<DealIndex>("/deals")
      .then((data) => {
        if (data) {
          setDealIndex(data);
          setLocal(CACHE_KEYS.DEAL_INDEX, data);
        }
      })
      .catch(() => {});

    api.get<Store[]>("/stores")
      .then((data) => {
        if (data) {
          setStores(data);
          setLocal(CACHE_KEYS.STORES, data);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-refresh on mount if any store's last scan is > 24h old
  useEffect(() => {
    if (stores.length === 0) return;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const needsRefresh = stores.some((s) => {
      if (!s.adUrl) return false;
      const lastScan = dealIndex.lastScanned[s.id];
      return !lastScan || lastScan < oneDayAgo;
    });

    if (needsRefresh) {
      refreshDeals();
    }
  }, [stores.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh Flipp deals if enabled and stale
  useEffect(() => {
    const dealsEnabled = localStorage.getItem("whisk_deals_enabled") === "true";
    if (!dealsEnabled) return;

    const zip = localStorage.getItem("whisk_zip_code");
    const storesRaw = localStorage.getItem("whisk_preferred_stores");
    if (!zip || !storesRaw) return;

    const lastRefresh = localStorage.getItem(FLIPP_REFRESH_KEY);
    if (lastRefresh && Date.now() - new Date(lastRefresh).getTime() < FLIPP_STALE_MS) return;

    try {
      const preferred = JSON.parse(storesRaw) as string[];
      if (preferred.length > 0) {
        refreshFromFlipp(zip, preferred);
      }
    } catch {
      // Invalid stored data
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDeals = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await api.post("/deals/refresh");
      // Re-fetch updated deals
      const data = await api.get<DealIndex>("/deals");
      if (data) {
        setDealIndex(data);
        setLocal(CACHE_KEYS.DEAL_INDEX, data);
      }
    } catch {
      // Silently fail
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refreshFromFlipp = useCallback(async (zip: string, preferredStores: string[]) => {
    setIsRefreshing(true);
    try {
      await api.post("/deals/flipp", { zip, stores: preferredStores });
      localStorage.setItem(FLIPP_REFRESH_KEY, new Date().toISOString());
      // Re-fetch merged deal index
      const data = await api.get<DealIndex>("/deals");
      if (data) {
        setDealIndex(data);
        setLocal(CACHE_KEYS.DEAL_INDEX, data);
      }
    } catch {
      // Silently fail
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const scanAdUrl = useCallback(async (url: string, storeId?: string) => {
    try {
      await api.post("/deals/scan", { url, storeId });
      // Re-fetch
      const data = await api.get<DealIndex>("/deals");
      if (data) {
        setDealIndex(data);
        setLocal(CACHE_KEYS.DEAL_INDEX, data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  const getDealsForItem = useCallback(
    (itemName: string): Deal[] => {
      const fakeItem: ShoppingItem = {
        id: "lookup",
        name: itemName,
        category: "other",
        checked: false,
      };
      const matches = matchDealsToList([fakeItem], activeDeals);
      return matches.get("lookup") ?? [];
    },
    [activeDeals]
  );

  const getBestStoreForList = useCallback(
    (items: ShoppingItem[]) => {
      return getBestStore(items, activeDeals);
    },
    [activeDeals]
  );

  const matchDeals = useCallback(
    (items: ShoppingItem[]) => {
      return matchDealsToList(items, activeDeals);
    },
    [activeDeals]
  );

  return {
    deals: activeDeals,
    stores,
    isRefreshing,
    refreshDeals,
    refreshFromFlipp,
    scanAdUrl,
    getDealsForItem,
    getBestStoreForList,
    matchDeals,
    dealIndex,
  };
}
