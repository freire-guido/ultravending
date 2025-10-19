"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type VendingStateType = "IDLE" | "CLAIMED" | "CHATTING" | "DISPENSING" | "DONE";

interface Snapshot {
  state: VendingStateType;
  sessionId: string;
  lockedByName: string | null;
  updatedAt: number;
}

function ClaimInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("sessionId") ?? "";
  const [name, setName] = useState<string>("");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await fetch("/api/vending/state", { cache: "no-store" });
        if (!res.ok) throw new Error("state fetch failed");
        const data = (await res.json()) as Snapshot;
        if (!stopped) setSnap(data);
      } catch {
        // ignore
      } finally {
        if (!stopped) setTimeout(poll, 1000);
      }
    }
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  const canControl = useMemo(() => snap && snap.sessionId === sessionId, [snap, sessionId]);

  async function onClaim() {
    setError("");
    const res = await fetch("/api/vending/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, name: name || "Guest" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.message || "Failed to claim. It might be busy." );
      return;
    }
  }

  async function onStartChat() {
    await fetch("/api/vending/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }

  async function onDispense() {
    await fetch("/api/vending/dispense", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }

  async function onMarkDone() {
    await fetch("/api/vending/dispense", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mark: "done" }),
    });
  }

  async function onCancel() {
    await fetch("/api/vending/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    router.push("/");
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 gap-6">
      <div className="text-2xl font-bold">Claim Session</div>
      {!canControl && (
        <div className="text-red-600">This link is no longer valid or machine busy.</div>
      )}
      {snap?.state === "IDLE" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <input
            className="border rounded p-3 text-black"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="bg-black text-white rounded p-3" onClick={onClaim}>Claim</button>
          {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>
      )}
      {snap?.state === "CLAIMED" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Claimed as {snap.lockedByName}</div>
          <button className="bg-blue-600 text-white rounded p-3" onClick={onStartChat}>Start Chat (placeholder)</button>
          <button className="bg-gray-800 text-white rounded p-3" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {snap?.state === "CHATTING" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Chatting... (OpenAI placeholder running on machine)</div>
          <button className="bg-green-600 text-white rounded p-3" onClick={onDispense}>Dispense (placeholder)</button>
          <button className="bg-gray-800 text-white rounded p-3" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {snap?.state === "DISPENSING" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Dispensing (placeholder)...</div>
          <button className="bg-green-700 text-white rounded p-3" onClick={onMarkDone}>Mark Done</button>
        </div>
      )}
      {snap?.state === "DONE" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Done. Thank you!</div>
          <button className="bg-black text-white rounded p-3" onClick={onCancel}>Finish</button>
        </div>
      )}
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full flex items-center justify-center">Loading…</div>}>
      <ClaimInner />
    </Suspense>
  );
}

