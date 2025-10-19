"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type VendingStateType = "IDLE" | "CLAIMED" | "CHATTING" | "DISPENSING" | "DONE";

interface Snapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
}

export default function Home() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const lastSessionRef = useRef<string>("");

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

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-black text-white p-6 gap-6">
      <div className="text-3xl font-bold">UltraVending</div>
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
        <div className="flex flex-col items-center gap-2">
          <div className="text-xl">{labelForState(snap)}</div>
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
