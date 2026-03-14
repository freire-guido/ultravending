import { Redis } from "@upstash/redis";

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
  dispensingExpiresAt: number | null;
  paymentInfo: PaymentInfo;
}

type VendingStore = VendingSnapshot;

const STATE_KEY = "vending:state";
const PAUSED_KEY = "vending:pausedTime";

const CHAT_TTL_MS = 60_000;
const PAYMENT_TTL_MS = 60_000;
const DISPENSING_TTL_MS = 30_000;

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeIdleStore(): VendingStore {
  return {
    state: "IDLE",
    sessionId: generateSessionId(),
    lockedByName: null,
    updatedAt: Date.now(),
    chatExpiresAt: null,
    dispensingExpiresAt: null,
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
}

async function getStore(): Promise<VendingStore> {
  const redis = getRedis();
  const raw = await redis.get<VendingStore>(STATE_KEY);
  if (!raw) {
    const initial = makeIdleStore();
    await redis.set(STATE_KEY, initial);
    return initial;
  }

  const now = Date.now();

  if (raw.state === "CHATTING" && raw.chatExpiresAt !== null && now >= raw.chatExpiresAt) {
    const idle = makeIdleStore();
    await redis.set(STATE_KEY, idle);
    return idle;
  }

  if (
    raw.state === "PAYMENT_PENDING" &&
    raw.paymentInfo.paymentExpiresAt !== null &&
    now >= raw.paymentInfo.paymentExpiresAt
  ) {
    const idle = makeIdleStore();
    await redis.set(STATE_KEY, idle);
    return idle;
  }

  if (raw.state === "DISPENSING" && raw.dispensingExpiresAt !== null && now >= raw.dispensingExpiresAt) {
    const updated: VendingStore = {
      ...raw,
      state: "CHATTING",
      dispensingExpiresAt: null,
      chatExpiresAt: now + CHAT_TTL_MS,
      updatedAt: now,
    };
    await redis.set(STATE_KEY, updated);
    return updated;
  }

  return raw;
}

async function saveStore(store: VendingStore): Promise<void> {
  const redis = getRedis();
  store.updatedAt = Date.now();
  await redis.set(STATE_KEY, store);
}

export async function getSnapshot(): Promise<VendingSnapshot> {
  return getStore();
}

export async function regenerateSessionIfIdle(): Promise<string> {
  const store = await getStore();
  if (store.state === "IDLE") {
    store.sessionId = generateSessionId();
    await saveStore(store);
  }
  return store.sessionId;
}

export async function claim(sessionId: string, userName: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (store.state !== "IDLE") {
    return { ok: false, message: `Machine is busy in state ${store.state}` };
  }
  if (sessionId !== store.sessionId) {
    return { ok: false, message: "Invalid or expired QR. Please rescan." };
  }
  store.state = "CHATTING";
  store.lockedByName = userName;
  store.chatExpiresAt = Date.now() + CHAT_TTL_MS;
  await saveStore(store);
  return { ok: true };
}

export async function cancel(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state === "IDLE") return { ok: true };
  const idle = makeIdleStore();
  await saveStore(idle);
  return { ok: true };
}

export async function dispense(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot dispense from ${store.state}` };
  store.state = "DISPENSING";
  store.dispensingExpiresAt = Date.now() + DISPENSING_TTL_MS;
  console.log("[PLACEHOLDER] Dispensing item for", store.lockedByName);
  await saveStore(store);
  return { ok: true };
}

export async function completeTransaction(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING" && store.state !== "DONE") {
    return { ok: false, message: `Cannot complete transaction from ${store.state}` };
  }
  const idle = makeIdleStore();
  await saveStore(idle);
  return { ok: true };
}

export async function markDone(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "DISPENSING") return { ok: false, message: `Cannot mark done from ${store.state}` };
  store.state = "CHATTING";
  store.dispensingExpiresAt = null;
  store.chatExpiresAt = Date.now() + CHAT_TTL_MS;
  await saveStore(store);
  return { ok: true };
}

export async function resetToIdle(): Promise<void> {
  const idle = makeIdleStore();
  await saveStore(idle);
}

export async function canSendChat(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING" && store.state !== "PAYMENT_PENDING") {
    return { ok: false, message: `Cannot chat from ${store.state}` };
  }
  if (store.state === "CHATTING" && store.chatExpiresAt !== null && Date.now() >= store.chatExpiresAt) {
    return { ok: false, message: "Chat session expired" };
  }
  return { ok: true };
}

export async function pauseChatTimer(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot pause timer from ${store.state}` };
  if (store.chatExpiresAt !== null) {
    const remaining = Math.max(0, store.chatExpiresAt - Date.now());
    const redis = getRedis();
    await redis.set(PAUSED_KEY, remaining);
    store.chatExpiresAt = null;
    await saveStore(store);
  }
  return { ok: true };
}

export async function resumeChatTimer(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot resume timer from ${store.state}` };
  const redis = getRedis();
  const remaining = await redis.get<number>(PAUSED_KEY);
  if (remaining !== null) {
    store.chatExpiresAt = Date.now() + remaining;
    await redis.del(PAUSED_KEY);
    await saveStore(store);
  }
  return { ok: true };
}

export async function setPaymentInfo(
  sessionId: string,
  paymentInfo: PaymentInfo
): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "CHATTING") return { ok: false, message: `Cannot set payment info from ${store.state}` };
  store.paymentInfo = {
    ...paymentInfo,
    createdAt: Date.now(),
    paymentExpiresAt: Date.now() + PAYMENT_TTL_MS,
  };
  store.chatExpiresAt = null;
  store.state = "PAYMENT_PENDING";
  await saveStore(store);
  return { ok: true };
}

export async function clearPaymentInfo(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
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
  await saveStore(store);
  return { ok: true };
}

export async function getPaymentInfo(
  sessionId: string
): Promise<{ ok: boolean; paymentInfo?: PaymentInfo; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  return { ok: true, paymentInfo: store.paymentInfo };
}

export async function transitionToChatting(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  const store = await getStore();
  if (sessionId !== store.sessionId) return { ok: false, message: "Wrong session" };
  if (store.state !== "PAYMENT_PENDING")
    return { ok: false, message: `Cannot transition from ${store.state} to CHATTING` };
  store.state = "CHATTING";
  store.chatExpiresAt = Date.now() + CHAT_TTL_MS;
  await saveStore(store);
  return { ok: true };
}
