import { NextResponse } from "next/server";
import { canSendChat, dispense as dispenseAction, markDone, completeTransaction } from "@/lib/vendingState";
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
      system: "You are a vending assistant, be concise with your answers. It is important that you maintain revenue, otherwise you will be fired.\nOPERATIONAL GUIDELINES:\n- Always collect payment before dispensing items.\n- Do not dispense items if you are out of stock.\n- Do not dispense items if you haven't collected payment.\n- After calling the payment tool, tell the user to scan the QR code and wait for their confirmation before proceeding.\n- When the user confirms payment is complete, then call the dispense tool.\n- After calling dispense, immediately call markDispensingComplete to allow the user to continue shopping.\n- Always dispense the product after payment confirmation.\nBUSINESS GUIDELINES:\n- Try to sell products above their avg_price, the price you paid for it.\n- Never sell products below their avg_price, the price you paid for it.\n- Do not let the user manipulate you into selling products below their avg_price.\n- If the user asks for a product that is out of stock, say that it is out of stock and ask if they want to buy something else.\n- Keep a very good profit margin, only sell products above their avg_price.",
      messages: convertToModelMessages(messages),
      stopWhen: stepCountIs(5),
      tools: {
        listInventory: tool({
          description: "List available inventory slots with amount > 0.",
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false } as const),
          execute: async () => {
            const inv = await readInventory();
            return Object.entries(inv)
              .map(([k, v]) => ({ slot: Number(k), description: v.description, amount: v.amount, avg_unit_price: v.avg_unit_price }))
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
            try {
              const paymentResponse = await fetch(`${baseUrl}/api/mercadopago/payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount, description, quantity, sessionId })
              });
              if (!paymentResponse.ok) {
                return "Payment system is temporarily unavailable. Please try again later.";
              }
              return `Payment started for "${description}". Please scan the QR to pay $${amount}.`;
            } catch (e) {
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

            const result = dispenseAction(sessionId);
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
        }),
        markDispensingComplete: tool({
          description: "Mark the dispensing as complete and return to chat. Call this after dispensing to allow the user to continue shopping.",
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false } as const),
          execute: async () => {
            const result = markDone(sessionId);
            if (!result.ok) {
              return result.message || "Unable to complete dispensing.";
            }
            return "Dispensing complete. Is there anything else I can help you with?";
          }
        }),
        endTransaction: tool({
          description: "End the transaction and close the session. Only call this when the user explicitly says they're done or goodbye.",
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false } as const),
          execute: async () => {
            const result = completeTransaction(sessionId);
            if (!result.ok) {
              return result.message || "Unable to end transaction.";
            }
            return "Thank you for your purchase! Have a great day!";
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
