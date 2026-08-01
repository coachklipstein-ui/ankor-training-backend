import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

export const CoachListFilterSchema = z.object({
  org_id: uuid(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const GetCoachByIdSchema = z.object({
  coach_id: uuid(),
});

export const CreateCoachSchema = z.object({
  org_id: uuid(),
  full_name: z.string().trim().min(1).optional().nullable(),
  email: z.string().trim().email("email is required"),
  password: z.string().min(8, "password must be at least 8 characters"),
  phone: z.string().trim().optional().nullable(),
  cell_number: z.string().trim().optional().nullable(),
});

export const UpdateCoachSchema = z
  .object({
    user_id: uuid().optional().nullable(),
    full_name: z.string().trim().min(1).optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    cell_number: z.string().trim().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasUpdates = Object.values(value).some((val) => val !== undefined);
    if (!hasUpdates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No updates provided",
      });
    }
  });

export type CoachListFilterInput = z.infer<typeof CoachListFilterSchema>;
export type GetCoachByIdInput = z.infer<typeof GetCoachByIdSchema>;
export type CreateCoachInput = z.infer<typeof CreateCoachSchema>;
export type UpdateCoachInput = z.infer<typeof UpdateCoachSchema>;

export type CoachDto = {
  id: string;
  org_id: string | null;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cell_number: string | null;
};
