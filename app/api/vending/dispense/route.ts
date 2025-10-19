import { NextResponse } from "next/server";
import { dispense, markDone } from "@/lib/vendingState";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, mark } = body as { sessionId?: string; mark?: "done" };
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }
  if (mark === "done") {
    const resDone = markDone(sessionId);
    return NextResponse.json(resDone, { status: resDone.ok ? 200 : 409 });
  }
  const res = dispense(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}


