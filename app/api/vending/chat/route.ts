import { NextResponse } from "next/server";
import { startChat } from "@/lib/vendingState";
import OpenAI from "openai";

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

// Minimal chat message relay
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, messages } = body as {
    sessionId?: string;
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  };
  if (!sessionId || !Array.isArray(messages)) {
    return NextResponse.json({ ok: false, message: "Missing sessionId or messages" }, { status: 400 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "Server missing OPENAI_API_KEY" }, { status: 500 });
  }
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.7,
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    return NextResponse.json(
      { ok: true, message: { role: "assistant" as const, content } },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, message: "Chat failed" }, { status: 500 });
  }
}


