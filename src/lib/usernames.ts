import { z } from "zod";

export const usernameSchema = z.string().trim().toLowerCase().min(3).max(24)
  .regex(/^[a-z0-9_]+$/, "Use 3–24 letters, numbers, or underscores.");
export const usernameLoginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});