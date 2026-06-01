import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { LoginBody } from "../validation.js";
import { signToken, requireAuth } from "../lib/auth.js";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user || user.status !== "active") {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ userId: Number(user.id), email: user.email });

  res.json({
    success: true,
    token,
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
    },
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as typeof req & { user: { userId: number; email: string } }).user;

  const [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.userId))
    .limit(1);

  if (!dbUser) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json({
    id: Number(dbUser.id),
    name: dbUser.name,
    email: dbUser.email,
  });
});

export default router;
