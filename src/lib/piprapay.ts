import { logger } from "./logger";

const PIPRAPAY_BASE_URL = process.env.PIPRAPAY_BASE_URL || "https://pay.antdigitals.com/api";
const PIPRAPAY_API_KEY = process.env.PIPRAPAY_API_KEY || "";

export interface PipraPayVerifyResult {
  success: boolean;
  paymentId?: string;
  rawResponse?: unknown;
  errorReason?: string;
}

export async function verifyWithPipraPay(
  txid: string,
  expectedAmount: number,
): Promise<PipraPayVerifyResult> {
  if (!PIPRAPAY_API_KEY) {
    logger.warn("PIPRAPAY_API_KEY is not configured");
    return { success: false, errorReason: "PipraPay API key not configured" };
  }

  try {
    const requestBody = JSON.stringify({ pp_id: txid });
    const appDomain = (process.env.REPLIT_DOMAINS || "").split(",")[0].trim();
    const originHeader = appDomain ? `https://${appDomain}` : "";

    const response = await fetch(`${PIPRAPAY_BASE_URL}/verify-payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(requestBody).toString(),
        "mh-piprapay-api-key": PIPRAPAY_API_KEY,
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
        errorReason: `PipraPay API error: ${response.status} — ${JSON.stringify(data)}`,
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
