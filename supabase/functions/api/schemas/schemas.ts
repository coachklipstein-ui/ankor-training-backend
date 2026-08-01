import { z } from "https://esm.sh/zod@3.23.8";

const uuid = () =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "Invalid UUID");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

// ---- Auth signup ----
export const AthleteSchema = z.object({
  role: z.literal("athlete"),
  joinCode: z.string().trim().min(1),
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  cellNumber: z.string().optional(),
  graduationYear: z.number({ coerce: true }).int().min(1900).max(2100),
  position_id: uuid(),
  termsAccepted: z.literal(true),
  username: z.string().trim().min(3).max(50).optional(),
});
export const CoachSchema = z.object({
  role: z.literal("coach"),
  joinCode: z.string().trim().min(1),
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  cellNumber: z.string().optional(),
  termsAccepted: z.literal(true),
  username: z.string().trim().min(3).max(50).optional(),
});
export const ParentSchema = z.object({
  role: z.literal("parent"),
  joinCode: z.string().trim().min(1),
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  cellNumber: z.string().optional(),
  termsAccepted: z.literal(true),
  username: z.string().trim().min(3).max(50).optional(),
});
export const SignUpSchema = z.discriminatedUnion("role", [AthleteSchema, CoachSchema, ParentSchema]);
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const AuthLoginSchema = z.object({
  user_id: uuid(),
});
export type AuthLoginInput = z.infer<typeof AuthLoginSchema>;

// ---- Scorecard template (create) ----
export const SubskillInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int().positive().optional(),
  skill_id: uuid(),
});
export const CategoryInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int().positive().optional(),
  subskills: z.array(SubskillInputSchema).nonempty(),
});
export const ScorecardTemplateCreateSchema = z.object({
  createdBy: uuid().optional(), // required if no Bearer
  org_id: uuid(),
  sport_id: uuid().optional().nullable(),
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  categories: z.array(CategoryInputSchema).nonempty(),
});
export type ScorecardTemplateCreate = z.infer<typeof ScorecardTemplateCreateSchema>;
