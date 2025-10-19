import { NextResponse } from "next/server";
import { startChat } from "@/lib/vendingState";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }
  const res = startChat(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}


