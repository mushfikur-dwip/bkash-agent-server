import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  pgTable,
  bigserial,
  varchar,
  decimal,
  text,
  timestamp,
  bigint,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const { Pool } = pg;

export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);

export const usersTable = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  password: varchar("password", { length: 255 }).notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paymentStatusEnum = pgEnum("payment_status", ["approved"]);

export const paymentsTable = pgTable("payments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  txid: varchar("txid", { length: 100 }).notNull().unique(),
  transactionId: varchar("transaction_id", { length: 100 }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  customerMobile: varchar("customer_mobile", { length: 20 }),
  provider: varchar("provider", { length: 50 }),
  status: paymentStatusEnum("status").notNull().default("approved"),
  piprapayPaymentId: varchar("piprapay_payment_id", { length: 100 }),
  piprapayResponse: text("piprapay_response"),
  verifiedBy: bigint("verified_by", { mode: "number" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("payments_txid_idx").on(table.txid),
  uniqueIndex("payments_transaction_id_idx").on(table.transactionId),
]);

const schema = {
  usersTable,
  paymentsTable,
};

type Database = ReturnType<typeof drizzle<typeof schema>>;

let pool: pg.Pool | null = null;
let dbInstance: Database | null = null;

function getDatabase(): Database {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to configure Vercel environment variables?",
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }

  if (!dbInstance) {
    dbInstance = drizzle(pool, { schema });
  }

  return dbInstance;
}

export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDatabase(), property, receiver);
  },
});
