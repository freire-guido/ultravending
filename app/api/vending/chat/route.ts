import { NextResponse } from "next/server";
import { startChat, canSendChat, dispense as dispenseAction, pauseChatTimer, resumeChatTimer, setPaymentInfo } from "@/lib/vendingState";
import OpenAI from "openai";

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
  const { sessionId, messages } = body as {
    sessionId?: string;
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  };
  if (!sessionId || !Array.isArray(messages)) {
    return NextResponse.json({ ok: false, message: "Missing sessionId or messages" }, { status: 400 });
  }
  const allowed = canSendChat(sessionId);
  if (!allowed.ok) {
    return NextResponse.json({ ok: false, message: allowed.message || "Chat expired" }, { status: 409 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "Server missing OPENAI_API_KEY" }, { status: 500 });
  }
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5-nano";
  const promptId = process.env.PROMPT_ID;
  try {
    // Build Responses API request
    const input = messages.map((m) => ({
      role: m.role,
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
    }));

    const tools = [
      {
        type: "function",
        name: "dispense",
        description: "Dispense the agreed products for the current session.",
        parameters: {
          type: "object",
          properties: {
            amount: {
              type: "number",
              description: "The price amount of the product being dispensed"
            },
            productName: {
              type: "string",
              description: "The name of the product being dispensed"
            }
          },
          required: ["amount", "productName"],
          additionalProperties: false,
        },
      },
        {
          type: "function",
          name: "payment",
          description: "Collect payment for the agreed price of the product.",
          parameters: {
            type: "object",
            properties: {
              amount: {
                type: "number",
                description: "The price amount to charge for the product"
              },
              description: {
                type: "string",
                description: "Description of what the user is purchasing"
              },
              quantity: {
                type: "number",
                description: "The quantity of items being purchased"
              }
            },
            required: ["amount", "description", "quantity"],
            additionalProperties: false,
          },
        }
    ] as const;

    const baseRequest: Record<string, unknown> = {
      model,
      input,
      tools,
    };
    if (promptId) {
      // Use stored prompt as system instructions
      (baseRequest as Record<string, unknown>).prompt = { id: promptId };
    }

    const response = await client.responses.create(baseRequest as unknown as Parameters<typeof client.responses.create>[0]);

    // If the model requested tools, fulfill and continue
    const responseOutput = (response as { output?: unknown }).output;
    const toolCalls = Array.isArray(responseOutput)
      ? responseOutput.filter((o: { type?: string }) => o?.type === "function_call")
      : [];

    let userMessage = "";
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const name = call?.name as string | undefined;
        const id = call?.call_id as string | undefined;
        let args: unknown = undefined;
        try {
          args = call?.arguments ? JSON.parse(call.arguments as string) : {};
        } catch {}
        
        if (name === "dispense" && id) {
          // Pause timer during dispensing
          pauseChatTimer(sessionId);
          
          // Extract dispense parameters from function call
          const dispenseArgs = args as { amount?: number; productName?: string } || {};
          const amount = dispenseArgs.amount || 0;
          const productName = dispenseArgs.productName || "Product";
          
          const res = dispenseAction(sessionId);
          userMessage = `${productName} dispensed successfully! Please collect your item. Amount: $${amount}`;
        } else if (name === "payment" && id) {
          // Pause timer during payment so user doesn't run out of time
          pauseChatTimer(sessionId);
          
          try {
            // Extract payment parameters from function call
            const paymentArgs = args as { amount?: number; description?: string; quantity?: number } || {};
            const amount = paymentArgs.amount || 100; // Default to 100 if not provided
            const description = paymentArgs.description || "Vending Machine Purchase"; // Default description
            const quantity = paymentArgs.quantity || 1; // Default to 1 if not provided
            
            // Generate payment QR code
            const headers = new Headers(req.headers);
            const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
            const proto = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
            const baseUrl = `${proto}://${host}`;
            
            const paymentResponse = await fetch(`${baseUrl}/api/mercadopago/payment`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                amount,
                description,
                quantity,
                sessionId,
              }),
            });
            
            if (paymentResponse.ok) {
              const paymentData = await paymentResponse.json();
              
              // Store payment info in state
              setPaymentInfo(sessionId, {
                preferenceId: paymentData.data.preferenceId,
                qrCodeUrl: paymentData.data.qrCodeUrl,
                qrCodeDataUrl: paymentData.data.qrCodeDataUrl,
                amount: paymentData.data.amount,
                description: paymentData.data.description,
                createdAt: null, // Will be set by setPaymentInfo
                paymentExpiresAt: null, // Will be set by setPaymentInfo
              });
              
              userMessage = `Payment QR code generated! Please scan the QR code to complete your payment for "${description}". Amount: $${amount}`;
            } else {
              userMessage = "Payment system is temporarily unavailable. Please try again later.";
            }
          } catch (error) {
            console.error("Payment QR generation failed:", error);
            userMessage = "Payment system is temporarily unavailable. Please try again later.";
            // Resume timer if payment generation failed
            resumeChatTimer(sessionId);
          }
          
          // Set a timeout to resume timer if payment takes too long (5 minutes)
          setTimeout(() => {
            resumeChatTimer(sessionId);
          }, 5 * 60 * 1000); // 5 minutes
        }
      }
    }

    const content = (response as { output_text?: string }).output_text || userMessage;
    return NextResponse.json(
      { ok: true, message: { role: "assistant" as const, content } },
      { status: 200 }
    );
  } catch (error) {
    const err = error as { error?: { message?: string }; message?: string };
    // eslint-disable-next-line no-console
    console.error("[OPENAI_ERROR]", err);
    if (err?.error) {
      // eslint-disable-next-line no-console
      console.error("[OPENAI_ERROR.details]", err.error);
    }
    const details = err?.error?.message || err?.message || "Chat failed";
    return NextResponse.json({ ok: false, message: details }, { status: 500 });
  }
}


