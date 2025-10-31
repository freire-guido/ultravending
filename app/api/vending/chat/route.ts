import { NextResponse } from "next/server";
import { startChat, canSendChat, dispense as dispenseAction, pauseChatTimer, resumeChatTimer } from "@/lib/vendingState";
import { streamText, convertToModelMessages, tool, stepCountIs, UIMessage, jsonSchema } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: "Missing sessionId" }, { status: 400 });
  }
  try {
    const headers = new Headers(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
    const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const baseUrl = `${proto}://${host}`;
    const chatUrl = `${baseUrl}/claim?sessionId=${encodeURIComponent(sessionId)}`;
    // eslint-disable-next-line no-console
    console.log("[DEBUG] Chat URL:", chatUrl);
  } catch {
    // ignore logging errors
  }
  const res = startChat(sessionId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}

// Minimal chat message relay
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, messages } = body as { sessionId?: string; messages?: UIMessage[] };
  if (!sessionId || !Array.isArray(messages)) {
    return NextResponse.json({ ok: false, message: "Missing sessionId or messages" }, { status: 400 });
  }
  const allowed = canSendChat(sessionId);
  if (!allowed.ok) {
    return NextResponse.json({ ok: false, message: allowed.message || "Chat expired" }, { status: 409 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, message: "Server missing OPENAI_API_KEY" }, { status: 500 });
  }

  const model = openai(process.env.OPENAI_MODEL || "gpt-4o-mini");

  try {
    const headers = new Headers(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
    const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const baseUrl = `${proto}://${host}`;

    const result = await streamText({
      model,
      messages: convertToModelMessages(messages),
      system: "You are a vending assistant. Always collect payment before dispensing. Be concise and helpful.",
      stopWhen: stepCountIs(5),
      tools: {
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
              productName: { type: "string", description: "The name of the product being dispensed" }
            },
            required: ["amount", "productName"],
            additionalProperties: false
          } as const),
          execute: async (
            { amount, productName }: { amount: number; productName: string }
          ) => {
            pauseChatTimer(sessionId);
            const result = dispenseAction(sessionId);
            resumeChatTimer(sessionId);
            if (!result.ok) {
              return result.message || "Unable to dispense at this time.";
            }
            return `${productName} dispensed successfully. Please collect your item.`;
          }
        })
      }
    });

    return result.toUIMessageStreamResponse()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[AI_SDK_CHAT_ERROR]", error);
    return NextResponse.json({ ok: false, message: "Chat failed" }, { status: 500 });
  }
}


