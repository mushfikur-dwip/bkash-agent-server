import { Router, type IRouter, type Request } from "express";
import { db, paymentsTable } from "../db/index.js";
import { eq, or } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { createPipraPayCharge, verifyWithPipraPay } from "../lib/piprapay.js";

const router: IRouter = Router();

function getStringField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return "";
}

function getNumberField(data: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = data[key];
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue >= 0) return numberValue;
  }

  return 0;
}

function parsePipraPayDate(value: string): Date {
  if (!value) return new Date();

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto || req.protocol || "https";

  return `${protocol}://${req.get("host")}`;
}

router.post("/piprapay/webhook", async (req, res): Promise<void> => {
  const payload = req.body as Record<string, unknown>;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }

  const transactionId = getStringField(payload, "transaction_id", "trx_id", "txid");
  const ppId = getStringField(payload, "pp_id", "payment_id");
  const status = getStringField(payload, "status").toLowerCase();
  const amount = getNumberField(payload, "amount", "total");
  const sender = getStringField(payload, "sender_number", "sender", "customer_mobile", "customer_email_mobile");
  const date = parsePipraPayDate(getStringField(payload, "date", "created_at", "updated_at"));

  if (!transactionId) {
    res.status(400).json({ error: "transaction_id is required" });
    return;
  }

  if (status !== "completed") {
    res.json({ success: true, saved: false, message: `Ignored payment with status: ${status || "unknown"}` });
    return;
  }

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      txid: transactionId,
      transactionId,
      amount: String(amount),
      customerMobile: sender || null,
      provider: "PipraPay",
      status: "approved",
      piprapayPaymentId: ppId || null,
      piprapayResponse: JSON.stringify(payload),
      verifiedAt: date,
    })
    .onConflictDoUpdate({
      target: paymentsTable.transactionId,
      set: {
        amount: String(amount),
        customerMobile: sender || null,
        provider: "PipraPay",
        status: "approved",
        piprapayPaymentId: ppId || null,
        piprapayResponse: JSON.stringify(payload),
        verifiedAt: date,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json({
    success: true,
    saved: true,
    payment: {
      id: Number(payment.id),
      transaction_id: payment.transactionId,
      pp_id: payment.piprapayPaymentId,
      amount: Number(payment.amount),
      sender: payment.customerMobile,
      status: payment.status,
      date: payment.verifiedAt.toISOString(),
    },
  });
});

router.get("/transactions/piprapay-config", requireAuth, (_req, res): void => {
  res.json({
    api_key: process.env.PIPRAPAY_API_KEY || "",
    base_url: process.env.PIPRAPAY_BASE_URL || "https://pay.antdigitals.com/api",
  });
});

router.post("/transactions/verify", requireAuth, async (req, res): Promise<void> => {
  const txid = getStringField(req.body as Record<string, unknown>, "txid", "transaction_id");
  const amount = getNumberField(req.body as Record<string, unknown>, "amount");
  const customerMobile = getStringField(req.body as Record<string, unknown>, "customer_mobile", "sender");

  if (!txid) {
    res.status(400).json({ error: "transaction_id is required" });
    return;
  }

  if (amount <= 0) {
    res.status(400).json({ error: "amount must be greater than 0" });
    return;
  }

  const transactionId = txid.trim();

  const [existing] = await db
    .select()
    .from(paymentsTable)
    .where(
      or(
        eq(paymentsTable.transactionId, transactionId),
        eq(paymentsTable.txid, transactionId),
      ),
    )
    .limit(1);

  if (existing) {
    res.json({
      success: true,
      status: "approved",
      message: "Approved",
      payment: {
        id: Number(existing.id),
        txid: existing.transactionId ?? existing.txid,
        amount: Number(existing.amount),
        customer_mobile: existing.customerMobile ?? null,
        provider: existing.provider ?? null,
        status: existing.status,
        verified_at: existing.verifiedAt.toISOString(),
      },
    });
    return;
  }

  const charge = await createPipraPayCharge({
    txid: transactionId,
    amount,
    customerMobile: customerMobile || null,
    baseUrl: process.env.SERVER_PUBLIC_URL || getRequestBaseUrl(req),
  });

  if (!charge.success) {
    res.json({
      success: false,
      status: "rejected",
      message: charge.errorReason ?? "Payment initiation failed",
    });
    return;
  }

  const verification = await verifyWithPipraPay(transactionId, amount);

  if (!verification.success) {
    res.json({
      success: false,
      status: "rejected",
      message: verification.errorReason ?? "Not Found",
    });
    return;
  }

  const response = (verification.rawResponse ?? {}) as Record<string, unknown>;
  const responseAmount = getNumberField(response, "amount", "total") || amount;
  const sender = getStringField(response, "sender_number", "sender", "customer_mobile", "customer_email_mobile") || customerMobile;
  const ppId = getStringField(response, "pp_id", "payment_id") || verification.paymentId || transactionId;
  const paymentDate = parsePipraPayDate(getStringField(response, "date", "created_at", "updated_at"));

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      txid: transactionId,
      transactionId,
      amount: String(responseAmount),
      customerMobile: sender || null,
      provider: "PipraPay",
      status: "approved",
      piprapayPaymentId: ppId,
      piprapayResponse: JSON.stringify({
        create_charge: charge.rawResponse ?? null,
        verify: verification.rawResponse ?? null,
      }),
      verifiedAt: paymentDate,
    })
    .onConflictDoUpdate({
      target: paymentsTable.transactionId,
      set: {
        amount: String(responseAmount),
        customerMobile: sender || null,
        provider: "PipraPay",
        status: "approved",
        piprapayPaymentId: ppId,
        piprapayResponse: JSON.stringify({
          create_charge: charge.rawResponse ?? null,
          verify: verification.rawResponse ?? null,
        }),
        verifiedAt: paymentDate,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json({
    success: true,
    status: "approved",
    message: "Approved",
    payment: {
      id: Number(payment.id),
      txid: payment.transactionId ?? payment.txid,
      amount: Number(payment.amount),
      customer_mobile: payment.customerMobile ?? null,
      provider: payment.provider ?? null,
      status: payment.status,
      verified_at: payment.verifiedAt.toISOString(),
    },
  });
});

router.post("/transactions/confirm", requireAuth, async (req, res): Promise<void> => {
  const user = (req as typeof req & { user: { userId: number } }).user;
  const { pp_id, amount, customer_mobile, piprapay_response } = req.body as {
    pp_id: string;
    amount: number;
    customer_mobile?: string | null;
    piprapay_response: Record<string, unknown>;
  };

  if (!pp_id || !amount || !piprapay_response) {
    res.status(400).json({ error: "pp_id, amount, and piprapay_response are required" });
    return;
  }

  const ppId = String(pp_id).trim();

  if (typeof piprapay_response !== "object" || Array.isArray(piprapay_response)) {
    res.status(400).json({ error: "piprapay_response must be an object" });
    return;
  }

  if (piprapay_response.status !== "completed") {
    res.json({
      success: false,
      status: "rejected",
      message: `Transaction not completed (status: ${piprapay_response.status ?? "unknown"})`,
    });
    return;
  }

  const responseAmount = Number(piprapay_response.amount) || Number(piprapay_response.total) || 0;
  if (responseAmount > 0 && Math.abs(responseAmount - Number(amount)) > 0.01) {
    res.json({
      success: false,
      status: "rejected",
      message: `Amount mismatch: expected ${amount}, PipraPay returned ${responseAmount}`,
    });
    return;
  }

  const [existing] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.txid, ppId))
    .limit(1);

  if (existing) {
    res.json({
      success: false,
      status: "duplicate",
      message: "This payment ID has already been approved. Duplicate payment is not allowed.",
    });
    return;
  }

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      txid: ppId,
      transactionId: ppId,
      amount: String(amount),
      customerMobile: customer_mobile ?? null,
      provider: "PipraPay",
      status: "approved",
      piprapayPaymentId: String(piprapay_response.pp_id || ppId),
      piprapayResponse: JSON.stringify(piprapay_response),
      verifiedBy: user.userId,
      verifiedAt: new Date(),
    })
    .returning();

  res.json({
    success: true,
    status: "approved",
    message: "Payment approved and saved.",
    payment: {
      id: Number(payment.id),
      txid: payment.txid,
      amount: Number(payment.amount),
      customer_mobile: payment.customerMobile ?? null,
      provider: payment.provider ?? null,
      status: payment.status,
      verified_at: payment.verifiedAt.toISOString(),
    },
  });
});

export default router;
