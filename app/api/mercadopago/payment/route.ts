import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSnapshot, setPaymentInfo } from "@/lib/vendingState";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN!;

// Datos de la sucursal y POS creados
const STORE_ID = "71045421";
const POS_ID = "120213762";

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

    // Crear preference de MercadoPago para generar QR dinámico
    const preferenceData = {
      items: [
        {
          title: description,
          quantity: 1,
          unit_price: amount,
          currency_id: "ARS",
        },
      ],
      back_urls: {
        success: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/claim?sessionId=${sessionId}&status=success`,
        failure: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/claim?sessionId=${sessionId}&status=failure`,
        pending: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/claim?sessionId=${sessionId}&status=pending`,
      },
      external_reference: sessionId,
      notification_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/mercadopago/webhook`,
    };

    // Crear preference en MercadoPago
    const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferenceData),
    });

    if (!preferenceResponse.ok) {
      const error = await preferenceResponse.text();
      console.error("MercadoPago preference creation failed:", error);
      console.error("Response status:", preferenceResponse.status);
      console.error("Response headers:", Object.fromEntries(preferenceResponse.headers.entries()));
      return NextResponse.json(
        { ok: false, message: `Failed to create payment preference: ${error}` },
        { status: 500 }
      );
    }

    const preference = await preferenceResponse.json();
    console.log("MercadoPago preference response:", JSON.stringify(preference, null, 2));
    
    // Para credenciales de prueba, usar el init_point como QR
    let qrCodeUrl = preference.qr_code || preference.init_point || preference.sandbox_init_point;

    // Si no hay QR code, usar el init_point como fallback
    if (!qrCodeUrl) {
      console.log("No QR code from preference, using init_point as fallback");
      qrCodeUrl = preference.init_point || preference.sandbox_init_point;
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
      preferenceId: preference.id,
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
        preferenceId: preference.id,
        initPoint: preference.init_point,
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
