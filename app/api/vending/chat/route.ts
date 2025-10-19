import { NextResponse } from "next/server";
import { startChat } from "@/lib/vendingState";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }
  try {
    const headers = new Headers(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
    const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const baseUrl = `${proto}://${host}`;
    const chatUrl = `${baseUrl}/claim?sessionId=${encodeURIComponent(sessionId)}`;
    // eslint-disable-next-line no-console
    console.log("[DEBUG] Chat URL:", chatUrl);
  } catch {
    // ignore logging errors
  }
  const res = startChat(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}


