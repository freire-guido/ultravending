import { NextResponse } from "next/server";
import { claim } from "@/lib/vendingState";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, name } = body as { sessionId?: string; name?: string };
  if (!sessionId || !name) {
    return NextResponse.json({ ok: false, message: "Missing sessionId or name" }, { status: 400 });
  }
  const res = claim(sessionId, name);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}


