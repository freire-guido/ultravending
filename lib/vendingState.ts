export type VendingStateType = "IDLE" | "CLAIMED" | "CHATTING" | "DISPENSING" | "DONE";

export interface VendingSnapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
  chatExpiresAt: number | null;
}

type VendingStore = VendingSnapshot;

function generateSessionId(): string {
  // Lightweight random id, we also have uuid in deps if desired
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CHAT_TTL_MS = 30_000;

const store: VendingStore = {
  state: "IDLE",
  sessionId: generateSessionId(),
  lockedByName: null,
  updatedAt: Date.now(),
  chatExpiresAt: null,
};

function touch(): void {
  store.updatedAt = Date.now();
}

function expireIfNeeded(): void {
  if (store.state === "CHATTING" && store.chatExpiresAt !== null) {
    const now = Date.now();
    if (now >= store.chatExpiresAt) {
      resetToIdle();
    }
  }
}

export function getSnapshot(): VendingSnapshot {
  expireIfNeeded();
  return { ...store };
}

export function ensureIdleSession(): string {
  if (store.state !== "IDLE" || !store.sessionId) return store.sessionId;
  return store.sessionId;
}

export function regenerateSessionIfIdle(): string {
  if (store.state === "IDLE") {
    store.sessionId = generateSessionId();
    touch();
  }
  return store.sessionId;
}

export function claim(sessionId: string, userName: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (store.state !== "IDLE") {
    return { ok: false, message: `Machine is busy in state ${store.state}` };
  }
  if (sessionId !== store.sessionId) {
    return { ok: false, message: "Invalid or expired QR. Please rescan." };
  }
  store.state = "CLAIMED";
  store.lockedByName = userName;
  touch();
  return { ok: true };
}

export function startChat(sessionId: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CLAIMED") return { ok: false, message: `Cannot start chat from ${store.state}` };
  store.state = "CHATTING";
  store.chatExpiresAt = Date.now() + CHAT_TTL_MS;
  touch();
  return { ok: true };
}

export function cancel(sessionId: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state === "IDLE") return { ok: true };
  store.state = "IDLE";
  store.lockedByName = null;
  store.sessionId = generateSessionId();
  store.chatExpiresAt = null;
  touch();
  return { ok: true };
}

export function dispense(sessionId: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot dispense from ${store.state}` };
  store.state = "DISPENSING";
  // Placeholder for physical dispense
  console.log("[PLACEHOLDER] Dispensing item for", store.lockedByName);
  touch();
  // Auto-transition to DONE then back to IDLE after short delay
  setTimeout(() => {
    store.state = "DONE";
    touch();
    setTimeout(() => {
      resetToIdle();
    }, 2000);
  }, 1000);
  return { ok: true };
}

export function markDone(sessionId: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "DISPENSING") return { ok: false, message: `Cannot mark done from ${store.state}` };
  store.state = "DONE";
  touch();
  return { ok: true };
}

export function resetToIdle(): void {
  store.state = "IDLE";
  store.lockedByName = null;
  store.sessionId = generateSessionId();
  store.chatExpiresAt = null;
  touch();
}

export function canSendChat(sessionId: string): { ok: boolean; message?: string } {
  expireIfNeeded();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot chat from ${store.state}` };
  return { ok: true };
}

// Simple timer pause/resume for chat operations
let pausedTimeRemaining: number | null = null;

export function pauseChatTimer(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot pause timer from ${store.state}` };
  if (store.chatExpiresAt !== null) {
    pausedTimeRemaining = Math.max(0, store.chatExpiresAt - Date.now());
    store.chatExpiresAt = null; // Pause by setting to null
  }
  return { ok: true };
}

export function resumeChatTimer(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot resume timer from ${store.state}` };
  if (pausedTimeRemaining !== null) {
    store.chatExpiresAt = Date.now() + pausedTimeRemaining;
    pausedTimeRemaining = null;
  }
  return { ok: true };
}


