"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type VendingStateType = "IDLE" | "CHATTING" | "PAYMENT_PENDING" | "DISPENSING" | "DONE";

interface PaymentInfo {
  preferenceId: string | null;
  qrCodeUrl: string | null;
  qrCodeDataUrl: string | null;
  amount: number | null;
  description: string | null;
  createdAt: number | null;
  paymentExpiresAt: number | null;
}

interface Snapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
  chatExpiresAt?: number | null;
  dispensingExpiresAt?: number | null;
  paymentInfo: PaymentInfo;
}

export default function Home() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const lastSessionRef = useRef<string>("");
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await fetch("/api/vending/state", { cache: "no-store" });
        if (!res.ok) throw new Error("state fetch failed");
        const data = (await res.json()) as Snapshot;
        if (!stopped) setSnap(data);
      } catch {
        // swallow
      } finally {
        if (!stopped) setTimeout(poll, 1000);
      }
    }
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  const claimUrl = useMemo(() => {
    if (!snap) return "";
    const url = new URL(window.location.origin + "/claim");
    url.searchParams.set("sessionId", snap.sessionId);
    return url.toString();
  }, [snap]);

  useEffect(() => {
    async function gen() {
      if (!claimUrl) return;
      if (lastSessionRef.current === snap?.sessionId) return;
      const dataUrl = await QRCode.toDataURL(claimUrl, { width: 512, margin: 1 });
      lastSessionRef.current = snap?.sessionId ?? "";
      setQrDataUrl(dataUrl);
    }
    void gen();
  }, [claimUrl, snap?.sessionId]);

  useEffect(() => {
    if (!snap || snap.state !== "CHATTING" || !snap.chatExpiresAt) return;
    let raf = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setNowMs(Date.now());
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [snap?.state, snap?.chatExpiresAt]);

  // Timer for payment countdown
  useEffect(() => {
    if (!snap || !snap.paymentInfo.paymentExpiresAt) return;
    if (snap.state !== "PAYMENT_PENDING") return;
    let raf = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setNowMs(Date.now());
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [snap?.state, snap?.paymentInfo.paymentExpiresAt]);

  const curtainRatio = useMemo(() => {
    if (!snap || snap.state !== "CHATTING" || !snap.chatExpiresAt) return 0;
    const remaining = Math.max(0, snap.chatExpiresAt - nowMs);
    const ratio = 1 - Math.max(0, Math.min(1, remaining / 60000));
    return ratio; // 0 => all white, 1 => all black
  }, [snap, nowMs]);

  const paymentCurtainRatio = useMemo(() => {
    if (!snap || !snap.paymentInfo.paymentExpiresAt) return 0;
    if (snap.state !== "PAYMENT_PENDING") return 0;
    const remaining = Math.max(0, snap.paymentInfo.paymentExpiresAt - nowMs);
    const ratio = 1 - Math.max(0, Math.min(1, remaining / 60000)); // 60s TTL
    return ratio; // 0 => all white, 1 => all black
  }, [snap, nowMs]);

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-black text-white p-6 gap-6 overflow-hidden">
      {/* White base background for chat */}
      {snap?.state === "CHATTING" && (
        <div className="absolute inset-0 bg-white" aria-hidden />
      )}
      {/* Right-to-left black curtain for chat */}
      {snap?.state === "CHATTING" && (
        <div
          className="absolute inset-y-0 right-0 bg-black transition-none"
          style={{ width: `${curtainRatio * 100}%` }}
          aria-hidden
        />
      )}
      {/* Payment timer overlay when in PAYMENT_PENDING state */}
      {snap?.state === "PAYMENT_PENDING" && (
        <div className="absolute inset-0 bg-white" aria-hidden />
      )}
      {/* Payment timer curtain */}
      {snap?.state === "PAYMENT_PENDING" && (
        <div
          className="absolute inset-y-0 right-0 bg-black transition-none"
          style={{ width: `${paymentCurtainRatio * 100}%` }}
          aria-hidden
        />
      )}
      {snap?.state === "IDLE" && (
        <div className="flex flex-col items-center gap-4">
          {snap.paymentInfo.qrCodeDataUrl ? (
            <>
              <div className="text-xl text-white">Waiting for payment ${snap.paymentInfo.amount}</div>
              <img src={snap.paymentInfo.qrCodeDataUrl} alt="Payment QR Code" className="w-[320px] h-[320px] bg-white p-2 rounded" />
              <div className="text-sm text-white">Pay with MercadoPago</div>
            </>
          ) : (
            <>
              <div className="text-xl">Scan to start</div>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR Code" className="w-[320px] h-[320px] bg-white p-2 rounded" />
              ) : (
                <div className="w-[320px] h-[320px] bg-white" />
              )}
            </>
          )}
          <div className="text-xs text-gray-400">Session: {snap.sessionId.slice(-6)}</div>
        </div>
      )}
      {/* Payment display when in PAYMENT_PENDING state */}
      {snap?.state === "PAYMENT_PENDING" && (
        <div className="flex flex-col items-center gap-4 relative z-10">
          <div className="text-xl text-white">Waiting for payment ${snap.paymentInfo.amount}</div>
          {snap.paymentInfo.qrCodeDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img 
              src={snap.paymentInfo.qrCodeDataUrl} 
              alt="Payment QR Code" 
              className="w-[320px] h-[320px] bg-white p-2 rounded" 
            />
          ) : (
            <div className="w-[320px] h-[320px] bg-white flex items-center justify-center">
              <div className="text-black">Generating QR...</div>
            </div>
          )}
          <div className="text-sm text-white">Pay with MercadoPago</div>
          <div className="text-xs text-gray-400">Session: {snap.sessionId.slice(-6)}</div>
        </div>
      )}
      {snap && snap.state !== "IDLE" && snap.state !== "PAYMENT_PENDING" && (
        <div className="relative flex flex-col items-center gap-2">
          <div className="text-xl text-black">
            {labelForState(snap)}
          </div>
          <div className="text-gray-400">Session {snap.sessionId.slice(-6)}</div>
        </div>
      )}
    </div>
  );
}

function labelForState(s: Snapshot): string {
  switch (s.state) {
    case "CHATTING":
      return `Chatting with ${s.lockedByName ?? "user"}`;
    case "PAYMENT_PENDING":
      return `Payment pending for ${s.lockedByName ?? "user"}`;
    case "DISPENSING":
      return `Dispensing for ${s.lockedByName ?? "user"}`;
    case "DONE":
      return `Done - ${s.lockedByName ?? "user"}`;
    default:
      return "";
  }
}
