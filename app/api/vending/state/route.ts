import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/vendingState";
import os from "os";

let lastLogTs = 0;

export async function GET(req: Request) {
  const snap = getSnapshot();
  try {
    if (snap.state === "IDLE" && snap.sessionId) {
      const headers = new Headers(req.headers);
      const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
      const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
      const baseUrl = `${proto}://${host}`;
      const url = `${baseUrl}/claim?sessionId=${encodeURIComponent(snap.sessionId)}`;
      const now = Date.now();
      if (now - lastLogTs > 2000) {
        // eslint-disable-next-line no-console
        console.log("[DEBUG] Claim/Chat URL:", url);
        // Also print local network candidates to help copy on another device
        try {
          const ifaces = os.networkInterfaces();
          const addrs: string[] = [];
          for (const name of Object.keys(ifaces)) {
            for (const info of ifaces[name] || []) {
              if (info && info.family === "IPv4" && !info.internal) {
                addrs.push(`http://${info.address}:3000/claim?sessionId=${encodeURIComponent(snap.sessionId)}`);
              }
            }
          }
          if (addrs.length) {
            // eslint-disable-next-line no-console
            console.log("[DEBUG] Network URLs:", addrs.join(" \n - "));
          }
        } catch {}
        lastLogTs = now;
      }
    }
  } catch {
    // ignore logging errors
  }
  return NextResponse.json(snap, { status: 200 });
}


