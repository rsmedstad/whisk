import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { PendingImport, RecipeIndexEntry } from "../../types";
import {
  BLOCKED_SHEET_FIXTURE,
  clearPendingImport,
  getPendingImport,
  setPendingImport,
} from "../../lib/pending-import";
import { findRecipeIdBySourceUrl } from "../../lib/source-url";
import { BlockedSourceSheet } from "./BlockedSourceSheet";
import { PendingImportBanner } from "./PendingImportBanner";

interface BlockedImportContextValue {
  openBlockedSheet: (item: PendingImport) => void;
}

const BlockedImportContext = createContext<BlockedImportContextValue>({
  openBlockedSheet: () => {},
});

export function useBlockedImport(): BlockedImportContextValue {
  return useContext(BlockedImportContext);
}

interface BlockedImportProviderProps {
  recipes: RecipeIndexEntry[];
  children: React.ReactNode;
}

export function BlockedImportProvider({ recipes, children }: BlockedImportProviderProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [sheetItem, setSheetItem] = useState<PendingImport | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(() => getPendingImport());

  const refreshPending = useCallback(() => {
    setPending(getPendingImport());
  }, []);

  const openBlockedSheet = useCallback((item: PendingImport) => {
    setSheetItem(item);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetItem(null);
    refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "whisk_pending_import") return;
      refreshPending();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", refreshPending);
    document.addEventListener("visibilitychange", refreshPending);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", refreshPending);
      document.removeEventListener("visibilitychange", refreshPending);
    };
  }, [refreshPending]);

  useEffect(() => {
    if (!pending) return;
    const existingId = findRecipeIdBySourceUrl(recipes, pending.url);
    if (existingId) {
      clearPendingImport(pending.url);
      setPending(null);
    }
  }, [recipes, pending]);

  useEffect(() => {
    const wantSheet =
      searchParams.get("sheet") === "blocked" || searchParams.get("saveHint") === "blocked";
    const wantBanner = searchParams.get("pending") === "1";
    if (wantBanner) {
      const seeded = { ...BLOCKED_SHEET_FIXTURE, timestamp: Date.now() };
      setPendingImport(seeded);
      setPending(seeded);
    }
    if (wantSheet) {
      setSheetItem({ ...BLOCKED_SHEET_FIXTURE, timestamp: Date.now() });
    }
  }, [searchParams]);

  const hideBanner =
    Boolean(sheetItem) ||
    location.pathname === "/import/ld" ||
    location.pathname.endsWith("/cook");

  const value = useMemo(() => ({ openBlockedSheet }), [openBlockedSheet]);

  return (
    <BlockedImportContext.Provider value={value}>
      {pending && !hideBanner && (
        <PendingImportBanner
          pending={pending}
          onFinish={() => openBlockedSheet(pending)}
          onDismiss={() => {
            clearPendingImport();
            setPending(null);
          }}
        />
      )}
      {children}
      {sheetItem && <BlockedSourceSheet item={sheetItem} onClose={closeSheet} />}
    </BlockedImportContext.Provider>
  );
}
