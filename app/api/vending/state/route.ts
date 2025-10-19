import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/vendingState";

export async function GET() {
  return NextResponse.json(getSnapshot(), { status: 200 });
}


