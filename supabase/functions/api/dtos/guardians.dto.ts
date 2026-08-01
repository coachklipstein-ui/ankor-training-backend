import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

const RelationshipSchema = z.enum(["mother", "father", "guardian", "step-parent", "grandparent", "sibling", "other"], {
  required_error: "relationship is required",
});

export const CreateGuardianSchema = z.object({
  org_id: uuid(),
  athlete_ids: z.array(uuid()).min(1, "athlete_ids is required"),
  full_name: z.string().trim().min(1, "full_name is required"),
  email: z.string().trim().email("email is required"),
  password: z.string().min(8, "password must be at least 8 characters"),
  phone: z.string().trim().optional().nullable(),
  address_line1: z.string().trim().optional().nullable(),
  address_line2: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  region: z.string().trim().optional().nullable(),
  postal_code: z.string().trim().optional().nullable(),
  country: z.string().trim().optional().nullable(),
  relationship: RelationshipSchema,
});

export const GuardianListFilterSchema = z.object({
  org_id: uuid(),
  name: z.string().trim().min(1).optional(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const GetGuardianByIdSchema = z.object({
  guardian_id: uuid(),
});

export const UpdateGuardianSchema = z
  .object({
    full_name: z.string().trim().min(1).optional().nullable(),
    email: z.string().trim().email("email is required").optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    address_line1: z.string().trim().optional().nullable(),
    address_line2: z.string().trim().optional().nullable(),
    city: z.string().trim().optional().nullable(),
    region: z.string().trim().optional().nullable(),
    postal_code: z.string().trim().optional().nullable(),
    country: z.string().trim().optional().nullable(),
    add_athletes: z
      .array(
        z.object({
          athlete_id: uuid(),
          relationship: RelationshipSchema,
        }),
      )
      .optional(),
    remove_athlete_ids: z.array(uuid()).optional(),
  })
  .superRefine((value, ctx) => {
    const hasFieldUpdate = Object.entries(value).some(([key, val]) => {
      if (key === "add_athletes" || key === "remove_athlete_ids") return false;
      return val !== undefined;
    });

    const addIds = value.add_athletes?.map((item) => item.athlete_id) ?? [];
    const removeIds = value.remove_athlete_ids ?? [];

    const hasAdd = addIds.length > 0;
    const hasRemove = removeIds.length > 0;

    if (!hasFieldUpdate && !hasAdd && !hasRemove) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No updates provided",
      });
      return;
    }

    const addSet = new Set(addIds);
    if (addSet.size !== addIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "add_athletes contains duplicate athlete_id values",
        path: ["add_athletes"],
      });
    }

    const removeSet = new Set(removeIds);
    if (removeSet.size !== removeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remove_athlete_ids contains duplicate athlete_id values",
        path: ["remove_athlete_ids"],
      });
    }

    const overlap = addIds.filter((id) => removeSet.has(id));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "athlete_id cannot be in both add_athletes and remove_athlete_ids",
        path: ["add_athletes"],
      });
    }
  });

export type CreateGuardianInput = z.infer<typeof CreateGuardianSchema>;
export type GuardianListFilterInput = z.infer<typeof GuardianListFilterSchema>;
export type GetGuardianByIdInput = z.infer<typeof GetGuardianByIdSchema>;
export type UpdateGuardianInput = z.infer<typeof UpdateGuardianSchema>;

export type GuardianDto = {
  id: string;
  org_id: string | null;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  athletes: {
    athlete_id: string;
    relationship: string | null;
  }[];
};
