import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

export const AthleteListFilterSchema = z.object({
  org_id: uuid(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  team_id: uuid().optional(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const GetAthleteByIdSchema = z.object({
  athlete_id: uuid(),
});

export const CreateAthleteSchema = z
  .object({
    org_id: uuid(),
    team_id: uuid(),
    first_name: z.string().trim().min(1, "first_name is required"),
    last_name: z.string().trim().min(1, "last_name is required"),
    full_name: z.string().trim().min(1).optional().nullable(),
    email: z.string().trim().email("email is required"),
    password: z.string().min(8, "password must be at least 8 characters"),
    phone: z.string().trim().optional().nullable(),
    cell_number: z.string().trim().optional().nullable(),
    gender: z.string().trim().min(1, "gender is required"),
    parent_email: z.string().trim().email("parent_email is required").optional().nullable(),
    parent_full_name: z.string().trim().min(1, "parent_full_name is required").optional().nullable(),
    parent_mobile_phone: z.string().trim().min(1, "parent_mobile_phone is required").optional().nullable(),
    position_id: uuid().optional().nullable(),
    relationship: z
      .enum(["mother", "father", "guardian", "step-parent", "grandparent", "sibling", "other"], {
        required_error: "relationship is required",
      })
      .optional()
      .nullable(),
    graduation_year: z.number({ coerce: true }).int().min(1900).max(2100).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasAnyParent =
      value.parent_email != null ||
      value.parent_full_name != null ||
      value.parent_mobile_phone != null ||
      value.relationship != null;

    if (!hasAnyParent) return;

    if (!value.parent_email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parent_email is required",
        path: ["parent_email"],
      });
    }
    if (!value.parent_full_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parent_full_name is required",
        path: ["parent_full_name"],
      });
    }
    if (!value.parent_mobile_phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parent_mobile_phone is required",
        path: ["parent_mobile_phone"],
      });
    }
    if (!value.relationship) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "relationship is required",
        path: ["relationship"],
      });
    }
  });

export const UpdateAthleteSchema = z
  .object({
    user_id: uuid().optional().nullable(),
    first_name: z.string().trim().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
    full_name: z.string().trim().min(1).optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    cell_number: z.string().trim().optional().nullable(),
    graduation_year: z.number({ coerce: true }).int().min(1900).max(2100).optional().nullable(),
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

export type AthleteListFilterInput = z.infer<typeof AthleteListFilterSchema>;
export type GetAthleteByIdInput = z.infer<typeof GetAthleteByIdSchema>;
export type CreateAthleteInput = z.infer<typeof CreateAthleteSchema>;
export type UpdateAthleteInput = z.infer<typeof UpdateAthleteSchema>;

export type AthleteTeamDto = {
  id: string;
  name: string | null;
};

export type AthleteDto = {
  id: string;
  org_id: string | null;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cell_number: string | null;
  gender: string | null;
  graduation_year: number | null;
  teams: AthleteTeamDto[];
  parent: {
    full_name: string | null;
    email: string | null;
    phone_number: string | null;
    relationship: string | null;
  } | null;
};
