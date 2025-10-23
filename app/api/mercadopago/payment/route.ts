import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSnapshot, setPaymentInfo } from "@/lib/vendingState";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN!;

// Datos de la sucursal y POS creados
const STORE_ID = "71045421";
const POS_ID = "PABE1";

interface PaymentRequest {
  amount: number;
  description: string;
  sessionId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as PaymentRequest;
    const { amount, description, sessionId } = body;

    if (!amount || !description || !sessionId) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields: amount, description, sessionId" },
        { status: 400 }
      );
    }

    if (!MP_ACCESS_TOKEN) {
      return NextResponse.json(
        { ok: false, message: "MercadoPago access token not configured" },
        { status: 500 }
      );
    }

    // Verificar que la sesión existe y está en estado correcto
    const snapshot = getSnapshot();
    if (snapshot.sessionId !== sessionId) {
      return NextResponse.json(
        { ok: false, message: "Invalid session" },
        { status: 400 }
      );
    }

    if (snapshot.state !== "CHATTING") {
      return NextResponse.json(
        { ok: false, message: `Cannot process payment from state: ${snapshot.state}` },
        { status: 400 }
      );
    }

    // Crear order de MercadoPago para QR (pagos presenciales)
    const orderData = {
      type: "qr",
      total_amount: amount.toString(),
      description: description,
      external_reference: sessionId,
      expiration_time: "PT15M", // 15 minutos de expiración
      config: {
        qr: {
          external_pos_id: POS_ID,
          mode: "dynamic"
        }
      },
      transactions: {
        payments: [
          {
            amount: amount.toString()
          }
        ]
      },
      items: [
        {
          title: description,
          unit_price: amount.toString(),
          quantity: 1,
          unit_measure: "unit"
        }
      ]
    };

    // Generar idempotency key único
    const idempotencyKey = `${sessionId}-${Date.now()}`;

    // Crear order en MercadoPago
    const orderResponse = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(orderData),
    });

    if (!orderResponse.ok) {
      const error = await orderResponse.text();
      console.error("MercadoPago order creation failed:", error);
      console.error("Response status:", orderResponse.status);
      console.error("Response headers:", Object.fromEntries(orderResponse.headers.entries()));
      return NextResponse.json(
        { ok: false, message: `Failed to create payment order: ${error}` },
        { status: 500 }
      );
    }

    const order = await orderResponse.json();
    console.log("MercadoPago order response:", JSON.stringify(order, null, 2));
    
    // Obtener el QR data del order
    let qrCodeUrl = order.type_response?.qr_data;
    
    if (!qrCodeUrl) {
      console.error("No QR data in order response:", order);
      return NextResponse.json(
        { ok: false, message: "No QR data received from MercadoPago" },
        { status: 500 }
      );
    }

    // Generar QR code image data
    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    // Configurar la información de pago
    const paymentInfo = {
      preferenceId: order.id, // Usar order.id en lugar de preference.id
      qrCodeUrl,
      qrCodeDataUrl,
      amount,
      description,
      createdAt: Date.now(),
      paymentExpiresAt: null, // Will be set by setPaymentInfo
    };

    // Establecer la información de pago y cambiar el estado
    const result = setPaymentInfo(sessionId, paymentInfo);
    
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        qrCodeUrl,
        qrCodeDataUrl,
        orderId: order.id,
        sessionId,
        amount,
        description,
        storeId: STORE_ID,
        posId: POS_ID,
        message: "Escanea el QR code con tu app de Mercado Pago para pagar",
      },
    });

  } catch (error) {
    console.error("Payment error:", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

// Endpoint para verificar el estado del pago
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, message: "Missing sessionId parameter" },
        { status: 400 }
      );
    }

    const snapshot = getSnapshot();
    if (snapshot.sessionId !== sessionId) {
      return NextResponse.json(
        { ok: false, message: "Invalid session" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        state: snapshot.state,
        paymentInfo: snapshot.paymentInfo,
        storeId: STORE_ID,
        posId: POS_ID,
      },
    });

  } catch (error) {
    console.error("Payment status error:", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
