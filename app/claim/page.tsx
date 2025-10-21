"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState<string>("");
  const listRef = useRef<HTMLDivElement | null>(null);

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

  async function onSubmit() {
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
    // Immediately start chat on success
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

  async function onCancel() {
    await fetch("/api/vending/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    router.push("/");
  }

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  async function onSend() {
    if (!input.trim()) return;
    const nextMessages = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(nextMessages);
    setInput("");
    const res = await fetch("/api/vending/chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, messages: nextMessages }),
    });
    if (!res.ok) return;
    const j = (await res.json()) as { ok: boolean; message?: { role: "assistant"; content: string } };
    if (j.ok && j.message) setMessages((m) => [...m, j.message!]);
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 gap-6">
      
      {!canControl && (
        <div className="text-red-600">This link is no longer valid or machine busy.</div>
      )}
      {snap?.state === "IDLE" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <input
            className="border border-white rounded p-3 text-white placeholder-gray-400 bg-transparent focus:outline-none focus:ring-2 focus:ring-white/60"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="bg-black text-white rounded p-3" onClick={onSubmit}>Start</button>
          {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>
      )}
      {snap?.state === "CLAIMED" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Starting chat for {snap.lockedByName}…</div>
          <button className="bg-gray-800 text-white rounded p-3" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {snap?.state === "CHATTING" && canControl && (
        <div className="w-full max-w-2xl mx-auto">
          <div className="flex flex-col h-[calc(100vh-8rem)]">
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto p-4 space-y-3"
              aria-live="polite"
              aria-label="Chat messages"
              role="log"
            >
              {messages.length === 0 && (
                <div className="text-sm text-gray-400">Say hi to start the conversation.</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[80%] rounded-2xl px-4 py-2 bg-blue-600 text-white"
                        : "max-w-[80%] rounded-2xl px-4 py-2 bg-black text-white border border-white"
                    }
                  >
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                  </div>
                </div>
              ))}
            </div>

            <form
              className="p-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void onSend();
              }}
              aria-label="Send message"
            >
              <input
                className="flex-1 rounded-md px-3 py-2 bg-white/10 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/40"
                placeholder="Type your message"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoComplete="off"
                aria-label="Message input"
              />
              <button type="submit" className="rounded-md px-4 py-2 bg-blue-600 text-white disabled:opacity-50" disabled={!input.trim()}>
                Send
              </button>
            </form>

            <div className="p-3 grid grid-cols-2 gap-2">
              <button type="button" className="bg-green-600 text-white rounded-md py-2" onClick={onDispense}>Dispense</button>
              <button type="button" className="bg-gray-800 text-white rounded-md py-2" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {snap?.state === "DISPENSING" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Dispensing (placeholder)...</div>
        </div>
      )}
      {snap?.state === "DONE" && canControl && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div>Done. Thank you!</div>
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

