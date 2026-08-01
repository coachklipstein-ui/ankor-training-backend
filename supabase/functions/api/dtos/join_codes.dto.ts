import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

const dateString = () =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "expires_at must be a valid ISO date string",
    });

export const JoinCodeListFilterSchema = z.object({
  org_id: uuid(),
  team_id: uuid().optional().nullable(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const GetJoinCodeSchema = z.object({
  code: z.string().trim().min(1, "code is required"),
});

export const CreateJoinCodeSchema = z.object({
  org_id: uuid(),
  team_id: uuid().optional().nullable(),
  max_uses: z.number({ coerce: true }).int().min(1).optional().default(1),
  expires_at: dateString(),
  is_active: z.boolean().optional().default(true),
  disabled: z.boolean().optional().default(false),
});

export const UpdateJoinCodeSchema = z
  .object({
    team_id: uuid().optional().nullable(),
    max_uses: z.number({ coerce: true }).int().min(1).optional(),
    expires_at: dateString().optional(),
    is_active: z.boolean().optional(),
    disabled: z.boolean().optional(),
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

export type JoinCodeListFilterInput = z.infer<typeof JoinCodeListFilterSchema>;
export type GetJoinCodeInput = z.infer<typeof GetJoinCodeSchema>;
export type CreateJoinCodeInput = z.infer<typeof CreateJoinCodeSchema>;
export type UpdateJoinCodeInput = z.infer<typeof UpdateJoinCodeSchema>;

export type JoinCodeDto = {
  code: string;
  org_id: string;
  team_id: string | null;
  max_uses: number;
  used_count: number;
  uses_count: number;
  expires_at: string;
  is_active: boolean;
  disabled: boolean;
  created_at: string;
  updated_at: string;
};
