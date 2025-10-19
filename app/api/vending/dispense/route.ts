import { NextResponse } from "next/server";
import { dispense } from "@/lib/vendingState";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }
  const res = dispense(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}


