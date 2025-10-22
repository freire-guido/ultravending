import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN!;

// Datos de la sucursal y POS creados
const STORE_ID = "71045421";
const POS_ID = "120213762";
const POS_QR_URL = "https://www.mercadopago.com/instore/merchant/qr/120213762/1cadcfd99eec48bca4adff18333941edb27f5840372b42199d94e2c65e4ca78b.png";

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

    // Usar el QR code de la sucursal "exactas" creada
    const qrCodeUrl = POS_QR_URL;

    // Generate QR code image data
    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        qrCodeUrl,
        qrCodeDataUrl,
        preferenceId: `POS_${POS_ID}`, // Usar el ID del POS como referencia
        initPoint: qrCodeUrl, // El QR code es el punto de inicio
        sessionId,
        amount,
        description,
        storeId: STORE_ID,
        posId: POS_ID,
      },
    });

  } catch (error) {
    console.error("Payment QR generation error:", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
