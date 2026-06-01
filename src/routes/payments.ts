import { Router, type IRouter } from "express";
import { db, paymentsTable } from "@workspace/db";
import { desc, ilike, sum, count, and, or, sql } from "drizzle-orm";
import { ListPaymentsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const PAGE_SIZE = 20;

router.get("/payments", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, date, page = 1 } = parsed.data;
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(paymentsTable.txid, `%${search}%`),
        ilike(paymentsTable.transactionId, `%${search}%`),
        ilike(paymentsTable.customerMobile, `%${search}%`),
      )
    );
  }

  if (date) {
    conditions.push(
      sql`DATE(${paymentsTable.verifiedAt}) = ${date}`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch payments with pagination
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(whereClause)
    .orderBy(desc(paymentsTable.verifiedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  // Total stats (no filters — always show full totals)
  const [stats] = await db
    .select({
      totalAmount: sum(paymentsTable.amount),
      totalCount: count(),
    })
    .from(paymentsTable);

  res.json({
    success: true,
    total_amount: Number(stats?.totalAmount ?? 0),
    total_count: Number(stats?.totalCount ?? 0),
    payments: payments.map((p) => ({
      id: Number(p.id),
      txid: p.transactionId ?? p.txid,
      amount: Number(p.amount),
      customer_mobile: p.customerMobile ?? null,
      provider: p.provider ?? null,
      status: p.status,
      verified_at: p.verifiedAt.toISOString(),
    })),
  });
});

export default router;
