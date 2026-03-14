import { NextResponse } from "next/server";
import { pauseChatTimer } from "@/lib/vendingState";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId) return NextResponse.json({ ok: false }, { status: 400 });
  const res = await pauseChatTimer(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
