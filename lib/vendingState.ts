export type VendingStateType = "IDLE" | "CHATTING" | "PAYMENT_PENDING" | "DISPENSING" | "DONE";

export interface PaymentInfo {
  preferenceId: string | null;
  qrCodeUrl: string | null;
  qrCodeDataUrl: string | null;
  amount: number | null;
  description: string | null;
  createdAt: number | null;
  paymentExpiresAt: number | null;
}

export interface VendingSnapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
  chatExpiresAt: number | null;
  paymentInfo: PaymentInfo;
}

type VendingStore = VendingSnapshot;

function generateSessionId(): string {
  // Lightweight random id, we also have uuid in deps if desired
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CHAT_TTL_MS = 60_000; // 60 seconds to match client progress bar
const PAYMENT_TTL_MS = 60_000; // 1 minute

const store: VendingStore = {
  state: "IDLE",
  sessionId: generateSessionId(),
  lockedByName: null,
  updatedAt: Date.now(),
  chatExpiresAt: null,
  paymentInfo: {
    preferenceId: null,
    qrCodeUrl: null,
    qrCodeDataUrl: null,
    amount: null,
    description: null,
    createdAt: null,
    paymentExpiresAt: null,
  },
};

function touch(): void {
  store.updatedAt = Date.now();
}

function expireIfNeeded(): void {
  const now = Date.now();
  
  // Check chat expiration
  if (store.state === "CHATTING" && store.chatExpiresAt !== null) {
    if (now >= store.chatExpiresAt) {
      resetToIdle();
      return;
    }
  }
  
  // Check payment expiration
  if (store.state === "PAYMENT_PENDING" && store.paymentInfo.paymentExpiresAt !== null) {
    if (now >= store.paymentInfo.paymentExpiresAt) {
      resetToIdle();
      return;
    }
  }
  
  // Check payment expiration when in CHATTING state with payment info
  if (store.state === "CHATTING" && store.paymentInfo.paymentExpiresAt !== null) {
    if (now >= store.paymentInfo.paymentExpiresAt) {
      resetToIdle();
      return;
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
  store.state = "CHATTING";
  store.lockedByName = userName;
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
  store.paymentInfo = {
    preferenceId: null,
    qrCodeUrl: null,
    qrCodeDataUrl: null,
    amount: null,
    description: null,
    createdAt: null,
    paymentExpiresAt: null,
  };
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

export function setPaymentInfo(sessionId: string, paymentInfo: PaymentInfo): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot set payment info from ${store.state}` };
  
  store.paymentInfo = { 
    ...paymentInfo, 
    createdAt: Date.now(),
    paymentExpiresAt: Date.now() + PAYMENT_TTL_MS
  };
  // Keep state as CHATTING so chat remains visible
  // store.state = "PAYMENT_PENDING"; // Removed this line
  touch();
  return { ok: true };
}

export function clearPaymentInfo(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  
  store.paymentInfo = {
    preferenceId: null,
    qrCodeUrl: null,
    qrCodeDataUrl: null,
    amount: null,
    description: null,
    createdAt: null,
    paymentExpiresAt: null,
  };
  touch();
  return { ok: true };
}

export function getPaymentInfo(sessionId: string): { ok: boolean; paymentInfo?: PaymentInfo; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  return { ok: true, paymentInfo: store.paymentInfo };
}

export function transitionToChatting(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "PAYMENT_PENDING") return { ok: false, message: `Cannot transition from ${store.state} to CHATTING` };
  
  store.state = "CHATTING";
  // Resume chat timer with remaining time
  resumeChatTimer(sessionId);
  touch();
  return { ok: true };
}

export function resumeChatTimerAfterPayment(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot resume timer from ${store.state}` };
  
  // Resume the chat timer with remaining time
  resumeChatTimer(sessionId);
  return { ok: true };
}


