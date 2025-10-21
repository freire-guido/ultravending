"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type VendingStateType = "IDLE" | "CLAIMED" | "CHATTING" | "DISPENSING" | "DONE";

interface Snapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
  chatExpiresAt?: number | null;
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

  const curtainRatio = useMemo(() => {
    if (!snap || snap.state !== "CHATTING" || !snap.chatExpiresAt) return 0;
    const remaining = Math.max(0, snap.chatExpiresAt - nowMs);
    const ratio = 1 - Math.max(0, Math.min(1, remaining / 30000));
    return ratio; // 0 => all white, 1 => all black
  }, [snap, nowMs]);

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-black text-white p-6 gap-6 overflow-hidden">
      {/* White base background for chat */}
      {snap?.state === "CHATTING" && (
        <div className="absolute inset-0 bg-white" aria-hidden />
      )}
      {/* Right-to-left black curtain */}
      {snap?.state === "CHATTING" && (
        <div
          className="absolute inset-y-0 right-0 bg-black transition-none"
          style={{ width: `${curtainRatio * 100}%` }}
          aria-hidden
        />
      )}
      {snap?.state === "IDLE" && (
        <div className="flex flex-col items-center gap-4">
          <div className="text-xl">Scan to start</div>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR Code" className="w-[320px] h-[320px] bg-white p-2 rounded" />
          ) : (
            <div className="w-[320px] h-[320px] bg-white" />
          )}
          <div className="text-xs text-gray-400">Session: {snap.sessionId.slice(-6)}</div>
        </div>
      )}
      {snap && snap.state !== "IDLE" && (
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
    case "CLAIMED":
      return `Claimed by ${s.lockedByName ?? "unknown"}`;
    case "CHATTING":
      return `Chatting with ${s.lockedByName ?? "user"}`;
    case "DISPENSING":
      return `Dispensing for ${s.lockedByName ?? "user"}`;
    case "DONE":
      return `Done - ${s.lockedByName ?? "user"}`;
    default:
      return "";
  }
}
