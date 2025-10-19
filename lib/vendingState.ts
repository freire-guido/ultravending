export type VendingStateType = "IDLE" | "CLAIMED" | "CHATTING" | "DISPENSING" | "DONE";

export interface VendingSnapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
}

type VendingStore = VendingSnapshot;

function generateSessionId(): string {
  // Lightweight random id, we also have uuid in deps if desired
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const store: VendingStore = {
  state: "IDLE",
  sessionId: generateSessionId(),
  lockedByName: null,
  updatedAt: Date.now(),
};

function touch(): void {
  store.updatedAt = Date.now();
}

export function getSnapshot(): VendingSnapshot {
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
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CLAIMED") return { ok: false, message: `Cannot start chat from ${store.state}` };
  store.state = "CHATTING";
  // Placeholder for OpenAI chat bootstrap
  console.log("[PLACEHOLDER] Starting OpenAI GPT-5 chat for", store.lockedByName);
  touch();
  return { ok: true };
}

export function cancel(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state === "IDLE") return { ok: true };
  store.state = "IDLE";
  store.lockedByName = null;
  store.sessionId = generateSessionId();
  touch();
  return { ok: true };
}

export function dispense(sessionId: string): { ok: boolean; message?: string } {
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot dispense from ${store.state}` };
  store.state = "DISPENSING";
  // Placeholder for physical dispense
  console.log("[PLACEHOLDER] Dispensing item for", store.lockedByName);
  touch();
  return { ok: true };
}

export function markDone(sessionId: string): { ok: boolean; message?: string } {
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
  touch();
}


