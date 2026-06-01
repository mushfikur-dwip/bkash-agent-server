import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const { default: app } = await import("../src/app");

    return app(req, res);
  } catch (err) {
    console.error("Failed to load server app", err);

    res.status(500).json({
      error: "Server failed to start",
      message: err instanceof Error ? err.message : "Unknown startup error",
    });
  }
}
