import { NextResponse } from "next/server";
import { canSendChat, dispense as dispenseAction, pauseChatTimer, resumeChatTimer } from "@/lib/vendingState";
import { readInventory, decrementSlot } from "@/lib/inventory";
import { streamText, tool, stepCountIs, jsonSchema, convertToModelMessages, UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json().catch(() => ({ messages: [] }));
  
  // Get sessionId from query string (useChat sends it in the URL)
  const sessionId = new URL(req.url).searchParams.get("sessionId") || "";
  
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }

  const allowed = canSendChat(sessionId);
  if (!allowed.ok) {
    return NextResponse.json({ ok: false, message: allowed.message || "Chat expired" }, { status: 409 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, message: "Server missing OPENAI_API_KEY" }, { status: 500 });
  }

  // Validate messages array
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ ok: false, message: "Invalid messages array" }, { status: 400 });
  }

  const model = openai(process.env.OPENAI_MODEL || "gpt-5-nano");

  try {
    const headers = new Headers(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
    const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const baseUrl = `${proto}://${host}`;

    const result = streamText({
      model,
      system: "You are a vending assistant. Always collect payment before dispensing. Be concise and helpful. Before proposing or dispensing items, first call the listInventory tool to see available slots (amount > 0). Use the chosen slot's description as the product name when charging and dispensing. Never attempt to dispense out-of-stock items; re-check inventory immediately before dispensing.",
      messages: convertToModelMessages(messages),
      stopWhen: stepCountIs(5),
      tools: {
        listInventory: tool({
          description: "List available inventory slots with amount > 0.",
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false } as const),
          execute: async () => {
            const inv = await readInventory();
            return Object.entries(inv)
              .map(([k, v]) => ({ slot: Number(k), description: v.description, amount: v.amount }))
              .filter((x) => x.amount > 0)
              .sort((a, b) => a.slot - b.slot);
          }
        }),
        payment: tool({
          description: "Collect payment for the agreed price of the product.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              amount: { type: "number", description: "The price amount to charge for the product" },
              description: { type: "string", description: "Description of what the user is purchasing" },
              quantity: { type: "number", description: "The quantity of items being purchased" }
            },
            required: ["amount", "description", "quantity"],
            additionalProperties: false
          } as const),
          execute: async (
            { amount, description, quantity }: { amount: number; description: string; quantity: number }
          ) => {
            pauseChatTimer(sessionId);
            try {
              const paymentResponse = await fetch(`${baseUrl}/api/mercadopago/payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount, description, quantity, sessionId })
              });
              if (!paymentResponse.ok) {
                return "Payment system is temporarily unavailable. Please try again later.";
              }
              // Resume after a grace window to allow user to scan/pay
              setTimeout(() => {
                resumeChatTimer(sessionId);
              }, 5 * 60 * 1000);
              return `Payment started for "${description}". Please scan the QR to pay $${amount}.`;
            } catch (e) {
              resumeChatTimer(sessionId);
              return "Payment system is temporarily unavailable. Please try again later.";
            }
          }
        }),
        dispense: tool({
          description: "Dispense the agreed products for the current session.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              amount: { type: "number", description: "The price amount of the product being dispensed" },
              productName: { type: "string", description: "The name of the product being dispensed" },
              slot: { type: "number", description: "Inventory slot (0-9) to decrement", minimum: 0, maximum: 9 }
            },
            required: ["amount", "productName"],
            additionalProperties: false
          } as const),
          execute: async (
            { amount, productName, slot }: { amount: number; productName: string; slot?: number }
          ) => {
            // Validate inventory and override productName from slot if provided
            if (typeof slot === "number" && Number.isInteger(slot)) {
              const inv = await readInventory();
              const item = inv[String(slot)];
              if (!item || item.amount <= 0) {
                return "Selected slot is out of stock.";
              }
              if (item.description && item.description.trim().length > 0) {
                productName = item.description;
              } else {
                productName = `Slot ${slot}`;
              }
            }

            pauseChatTimer(sessionId);
            const result = dispenseAction(sessionId);
            resumeChatTimer(sessionId);
            if (!result.ok) {
              return result.message || "Unable to dispense at this time.";
            }
            if (typeof slot === "number" && Number.isInteger(slot)) {
              try {
                await decrementSlot(slot);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[INVENTORY_DECREMENT_ERROR]", err);
              }
            }
            return `${productName} dispensed successfully. Please collect your item.`;
          }
        })
      }
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[AI_SDK_CHAT_ERROR]", error);
    return NextResponse.json({ ok: false, message: "Chat failed" }, { status: 500 });
  }
}
