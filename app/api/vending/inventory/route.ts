import { NextResponse } from "next/server";
import { readInventory } from "@/lib/inventory";

export async function GET() {
  try {
    const inventory = await readInventory();
    return NextResponse.json(inventory, { status: 200 });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[INVENTORY_READ_ERROR]", error);
    return NextResponse.json({ ok: false, message: "Failed to read inventory" }, { status: 500 });
  }
}


