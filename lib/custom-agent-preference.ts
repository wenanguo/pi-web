const STORAGE_KEY = "pi-custom-agent";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The custom agent a fresh composer starts with. Only an explicit pick is stored,
 * so a browser that never chose one starts an ordinary session.
 */
export function getPreferredCustomAgent(
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function setPreferredCustomAgent(
  agentId: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    if (agentId) storage.setItem(STORAGE_KEY, agentId);
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Browser storage is best-effort.
  }
}
