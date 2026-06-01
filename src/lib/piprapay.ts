import { logger } from "./logger.js";

export interface PipraPayVerifyResult {
  success: boolean;
  paymentId?: string;
  rawResponse?: unknown;
  errorReason?: string;
}

export interface PipraPayCreateChargeInput {
  txid: string;
  amount: number;
  customerMobile?: string | null;
  baseUrl: string;
}

export interface PipraPayCreateChargeResult {
  success: boolean;
  rawResponse?: unknown;
  errorReason?: string;
}

function getApiKey(): string {
  return process.env.PIPRAPAY_API_KEY || "";
}

function getBaseUrl(): string {
  return process.env.PIPRAPAY_BASE_URL || "https://pay.antdigitals.com/api";
}

function buildHeaders(body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
    "mh-piprapay-api-key": getApiKey(),
  };
}

function readMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;

  const record = data as Record<string, unknown>;
  const directMessage = record.message;
  if (typeof directMessage === "string" && directMessage.trim()) return directMessage;

  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return undefined;
}

export async function createPipraPayCharge(
  input: PipraPayCreateChargeInput,
): Promise<PipraPayCreateChargeResult> {
  if (!getApiKey()) {
    logger.warn("PIPRAPAY_API_KEY is not configured");
    return { success: false, errorReason: "PipraPay API key not configured" };
  }

  const normalizedBaseUrl = input.baseUrl.replace(/\/+$/, "");
  const requestBody = JSON.stringify({
    full_name: "Transaction Verify",
    email_mobile: input.customerMobile || "agent@example.com",
    amount: String(input.amount),
    metadata: {
      txid: input.txid,
      source: "agent-panel",
    },
    redirect_url: `${normalizedBaseUrl}/api/piprapay/return`,
    return_type: "GET",
    cancel_url: `${normalizedBaseUrl}/api/piprapay/cancel`,
    webhook_url: `${normalizedBaseUrl}/api/piprapay/webhook`,
    currency: "BDT",
  });

  try {
    const response = await fetch(`${getBaseUrl()}/create-charge`, {
      method: "POST",
      headers: buildHeaders(requestBody),
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json().catch(() => null);

    logger.info({ txid: input.txid, status: response.status, responseBody: data }, "PipraPay create charge response received");

    if (!response.ok) {
      return {
        success: false,
        rawResponse: data,
        errorReason: readMessage(data) ?? `PipraPay create charge error: ${response.status} — ${JSON.stringify(data)}`,
      };
    }

    return {
      success: true,
      rawResponse: data,
    };
  } catch (err) {
    logger.error({ err, txid: input.txid }, "PipraPay create charge call failed");
    return {
      success: false,
      errorReason: "PipraPay create charge unreachable. Please try again later.",
    };
  }
}

export async function verifyWithPipraPay(
  txid: string,
  expectedAmount: number,
): Promise<PipraPayVerifyResult> {
  if (!getApiKey()) {
    logger.warn("PIPRAPAY_API_KEY is not configured");
    return { success: false, errorReason: "PipraPay API key not configured" };
  }

  try {
    const requestBody = JSON.stringify({ pp_id: txid });
    const appDomain = (process.env.REPLIT_DOMAINS || "").split(",")[0].trim();
    const originHeader = appDomain ? `https://${appDomain}` : "";

    const response = await fetch(`${getBaseUrl()}/verify-payments`, {
      method: "POST",
      headers: {
        ...buildHeaders(requestBody),
        ...(originHeader && { "Origin": originHeader, "Referer": `${originHeader}/` }),
      },
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json() as Record<string, unknown>;

    logger.info({ txid, status: response.status, responseBody: data }, "PipraPay verify response received");

    if (!response.ok) {
      return {
        success: false,
        rawResponse: data,
        errorReason: readMessage(data) ?? `PipraPay API error: ${response.status} — ${JSON.stringify(data)}`,
      };
    }

    // PipraPay returns status: "completed" for successful payments
    const isSuccess = data.status === "completed";

    if (!isSuccess) {
      return {
        success: false,
        rawResponse: data,
        errorReason: `Transaction not completed (status: ${data.status})`,
      };
    }

    // Amount match check
    const responseAmount = Number(data.amount) || Number(data.total) || 0;

    if (responseAmount > 0 && Math.abs(responseAmount - expectedAmount) > 0.01) {
      return {
        success: false,
        rawResponse: data,
        errorReason: `Amount mismatch: expected ${expectedAmount}, got ${responseAmount}`,
      };
    }

    return {
      success: true,
      paymentId: String(data.pp_id || ""),
      rawResponse: data,
    };
  } catch (err) {
    logger.error({ err, txid }, "PipraPay API call failed");
    return {
      success: false,
      errorReason: "PipraPay API unreachable. Please try again later.",
    };
  }
}
