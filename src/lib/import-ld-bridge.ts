import {
  decodeImportLdHash,
  IMPORT_LD_ACK,
  isImportLdPayload,
  type ImportLdPayload,
} from "./bookmarklet";

const STORAGE_KEY = "whisk_import_ld";

let cached: ImportLdPayload | null | undefined;
let installed = false;

function store(payload: ImportLdPayload): void {
  cached = payload;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode — in-memory cache still works for this tab
  }
}

function readStored(): ImportLdPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isImportLdPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Install as early as possible (Login screen included) so postMessage isn't lost. */
export function installImportLdBridge(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  const fromHash = decodeImportLdHash(window.location.hash);
  if (fromHash) store(fromHash);
  else {
    const existing = readStored();
    if (existing) cached = existing;
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (!isImportLdPayload(event.data)) return;
    store(event.data);
    const source = event.source;
    if (source && typeof (source as Window).postMessage === "function") {
      try {
        (source as Window).postMessage({ v: 1, type: IMPORT_LD_ACK }, event.origin || "*");
      } catch {
        // opener may already be gone
      }
    }
  });
}

export function peekImportLdPayload(): ImportLdPayload | null {
  if (cached !== undefined) return cached;
  const fromHash = typeof window !== "undefined" ? decodeImportLdHash(window.location.hash) : null;
  if (fromHash) {
    cached = fromHash;
    return fromHash;
  }
  const stored = readStored();
  cached = stored;
  return stored;
}

export function clearImportLdPayload(): void {
  cached = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined" && window.location.hash.startsWith("#ld=")) {
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", url);
  }
}

installImportLdBridge();
