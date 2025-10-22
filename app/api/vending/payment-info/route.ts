import { NextResponse } from "next/server";
import { getPaymentInfo } from "@/lib/vendingState";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, message: "Missing sessionId parameter" },
      { status: 400 }
    );
  }

  const result = getPaymentInfo(sessionId);
  
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    paymentInfo: result.paymentInfo,
  });
}
