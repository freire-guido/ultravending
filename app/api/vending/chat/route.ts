import { NextResponse } from "next/server";
import { startChat, canSendChat, dispense as dispenseAction, pauseChatTimer, resumeChatTimer } from "@/lib/vendingState";
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
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: "function",
        name: "payment",
        description: "Collect payment for the agreed price of the product.",
        parameters: {
          type: "object",
          properties: {},
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
          const res = dispenseAction(sessionId);
          userMessage = "Product dispensed successfully! Please collect your item.";
        } else if (name === "payment" && id) {
          // Pause timer during payment processing
          pauseChatTimer(sessionId);
          userMessage = "Payment processed successfully! Your transaction is complete.";
          
          // Resume timer after payment processing (simulate 2 second delay)
          setTimeout(() => {
            resumeChatTimer(sessionId);
          }, 2000);
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


