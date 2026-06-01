import { z } from "zod";

export const LoginBody = z.object({
  email: z.string(),
  password: z.string(),
});

export const ListPaymentsQueryParams = z.object({
  search: z.string().optional(),
  date: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});
