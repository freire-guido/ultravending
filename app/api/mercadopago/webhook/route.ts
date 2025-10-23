import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSnapshot, clearPaymentInfo, transitionToChatting, resumeChatTimerAfterPayment } from "@/lib/vendingState";

// Asegurate de setearlas en Vercel
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET!;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN!;

/**
 * Extrae ts y v1 del header x-signature (formato: "ts=...,v1=...").
 * La verificación usa HMAC-SHA256 sobre:
 *   manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
 * y compara contra v1.
 * Fuente del esquema (manifest y parsing): casos públicos y discusiones de SDK. 
 */
function parseSignatureHeader(h: string | null) {
  if (!h) return null;
  const parts = h.split(",").map(s => s.trim());
  const map = Object.fromEntries(parts.map(p => p.split("=").map(s => s.trim())));
  const ts = map["ts"];
  const v1 = map["v1"];
  if (!ts || !v1) return null;
  return { ts, v1 };
}

function safeEqualHex(aHex: string, bHex: string) {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function verifyRequest({
  xSignature,
  xRequestId,
  dataId,
}: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}) {
  if (!WEBHOOK_SECRET || !xSignature || !xRequestId || !dataId) return false;

  const parsed = parseSignatureHeader(xSignature);
  if (!parsed) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parsed.ts};`;
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");

  return safeEqualHex(hmac, parsed.v1);
}

export async function POST(req: NextRequest) {
  // Leé el body *crudo* y luego parsealo.
  const raw = await req.text();
  // Puede venir data.id en query o en body según el tópico/simulador
  const url = new URL(req.url);
  const queryId = url.searchParams.get("id") || url.searchParams.get("data.id");

  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignorar */ }

  // dataId heurístico: query → body.data.id → body.id
  const dataId: string | null =
    (queryId as string) ??
    ((body?.data as Record<string, unknown>)?.id as string) ??
    (body?.id as string) ??
    null;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  const xTopic = req.headers.get("x-topic") || body?.type || ""; // puede variar por producto

  // (Opcional) Rechazá notifs muy viejas: ts ±5 min (si querés endurecer)
  // const nowSec = Math.floor(Date.now() / 1000);
  // const { ts } = parseSignatureHeader(xSignature || "") || {};
  // if (ts && Math.abs(nowSec - Number(ts)) > 300) return NextResponse.json({ ok: false }, { status: 400 });

  const ok = await verifyRequest({ xSignature, xRequestId, dataId });
  if (!ok) {
    // Importante responder rápido; no expongas detalle
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Responder rápido a MP (evitá timeouts de reintentos)
  // y despachar procesamiento asíncrono aparte si es pesado.
  // (Acá lo hacemos inline por simplicidad.)
  try {
    console.log("Webhook received:", { dataId, xTopic, xRequestId });
    
    if (dataId && (xTopic as string).toLowerCase().includes("order")) {
      // Handle order events (for QR payments)
      const resp = await fetch(`https://api.mercadopago.com/v1/orders/${dataId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        cache: "no-store",
      });
      const order = await resp.json();

      console.log("Order event", order.id, order.status);
      
      if (order.status === "paid") {
        // Order paid - clear payment info and resume chat timer
        const snapshot = getSnapshot();
        if (snapshot.state === "CHATTING" && snapshot.paymentInfo.preferenceId === order.id) {
          clearPaymentInfo(snapshot.sessionId);
          resumeChatTimerAfterPayment(snapshot.sessionId);
          console.log("Order paid for session:", snapshot.sessionId);
        } else if (snapshot.state === "PAYMENT_PENDING") {
          clearPaymentInfo(snapshot.sessionId);
          transitionToChatting(snapshot.sessionId);
          console.log("Order paid for session:", snapshot.sessionId);
        }
      } else if (order.status === "cancelled" || order.status === "expired") {
        // Order cancelled/expired - clear payment info and resume chat timer
        const snapshot = getSnapshot();
        if (snapshot.state === "CHATTING" && snapshot.paymentInfo.preferenceId === order.id) {
          clearPaymentInfo(snapshot.sessionId);
          resumeChatTimerAfterPayment(snapshot.sessionId);
          console.log("Order cancelled/expired for session:", snapshot.sessionId);
        } else if (snapshot.state === "PAYMENT_PENDING") {
          clearPaymentInfo(snapshot.sessionId);
          transitionToChatting(snapshot.sessionId);
          console.log("Order cancelled/expired for session:", snapshot.sessionId);
        }
      }
    } else if (dataId && (xTopic as string).toLowerCase().includes("payment")) {
      // Handle payment events (fallback for other payment methods)
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        cache: "no-store",
      });
      const payment = await resp.json();

      console.log("Payment event", payment.id, payment.status);
      
      if (payment.status === "approved") {
        const snapshot = getSnapshot();
        if (snapshot.state === "CHATTING" && snapshot.paymentInfo.preferenceId) {
          clearPaymentInfo(snapshot.sessionId);
          resumeChatTimerAfterPayment(snapshot.sessionId);
          console.log("Payment approved for session:", snapshot.sessionId);
        } else if (snapshot.state === "PAYMENT_PENDING") {
          clearPaymentInfo(snapshot.sessionId);
          transitionToChatting(snapshot.sessionId);
          console.log("Payment approved for session:", snapshot.sessionId);
        }
      } else if (payment.status === "rejected" || payment.status === "cancelled") {
        const snapshot = getSnapshot();
        if (snapshot.state === "CHATTING" && snapshot.paymentInfo.preferenceId) {
          clearPaymentInfo(snapshot.sessionId);
          resumeChatTimerAfterPayment(snapshot.sessionId);
          console.log("Payment failed for session:", snapshot.sessionId);
        } else if (snapshot.state === "PAYMENT_PENDING") {
          clearPaymentInfo(snapshot.sessionId);
          transitionToChatting(snapshot.sessionId);
          console.log("Payment failed for session:", snapshot.sessionId);
        }
      }
    }
    // Manejá otros tópicos: merchant_order, chargebacks, subscriptions, etc.
  } catch (e) {
    // Log interno; igual devolvemos 200 para evitar reintentos infinitos
    console.error("Webhook processing error", e);
  }

  return NextResponse.json({ ok: true });
}
