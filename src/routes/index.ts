import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import transactionsRouter from "./transactions.js";
import paymentsRouter from "./payments.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(transactionsRouter);
router.use(paymentsRouter);

export default router;
