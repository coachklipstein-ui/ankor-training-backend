import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

const PlanVisibilitySchema = z.enum(["private", "org", "shared", "prebuilt"]);
const PlanStatusSchema = z.enum(["draft", "published", "archived"]);
const PlanItemTypeSchema = z.enum(["drill", "note", "rest", "custom"]);

export const PlanListTypeSchema = z.enum(["prebuild", "custom"]);

export const PlanListFilterSchema = z
  .object({
    org_id: uuid(),
    type: PlanListTypeSchema,
    user_id: uuid().optional(),
    limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
    offset: z.number({ coerce: true }).int().min(0).optional().default(0),
  })
  .superRefine((value, ctx) => {
    if (value.type === "custom-plans" && !value.user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["user_id"],
        message: "user_id (UUID) is required for type=custom-plans",
      });
    }
  });

export const InvitedPlanListSchema = z.object({
  org_id: uuid(),
  user_id: uuid(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const GetPlanByIdSchema = z.object({
  plan_id: uuid(),
});

export const InvitePlanMembersSchema = z.object({
  user_ids: z.array(uuid()).min(1, "user_ids is required"),
  role: z.string().trim().min(1).optional().default("viewer"),
  added_by: uuid().optional().nullable(),
});

export const PlanItemSchema = z
  .object({
    section_title: z.string().trim().max(200).optional().nullable(),
    section_order: z.number({ coerce: true }).int().min(0).optional().nullable(),
    position: z.number({ coerce: true }).int().min(0).optional().nullable(),
    item_type: PlanItemTypeSchema.default("drill"),
    drill_id: uuid().optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    instructions: z.string().trim().max(4000).optional().nullable(),
    sets: z.number({ coerce: true }).int().min(0).optional().nullable(),
    reps: z.number({ coerce: true }).int().min(0).optional().nullable(),
    duration_min: z.number({ coerce: true }).int().min(0).optional().nullable(),
    duration_seconds: z.number({ coerce: true }).int().min(0).optional().nullable(),
    rest_seconds: z.number({ coerce: true }).int().min(0).optional().nullable(),
    config: z.record(z.unknown()).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.item_type === "drill" && !value.drill_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["drill_id"],
        message: "drill_id is required when item_type=drill",
      });
    }
  });

export const CreatePlanSchema = z.object({
  owner_user_id: uuid(),
  org_id: uuid().optional().nullable(),
  type: PlanListTypeSchema.default("custom"),
  name: z.string().trim().min(1, "name is required").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  visibility: PlanVisibilitySchema.optional(),
  status: PlanStatusSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional().default([]),
  estimated_minutes: z.number({ coerce: true }).int().min(0).optional().nullable(),
  items: z.array(PlanItemSchema).min(1, "items is required"),
});

export const UpdatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional().nullable(),
    visibility: PlanVisibilitySchema.optional(),
    status: PlanStatusSchema.optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    estimated_minutes: z.number({ coerce: true }).int().min(0).optional().nullable(),
    org_id: uuid().optional().nullable(),
    add_items: z.array(PlanItemSchema).optional().default([]),
    remove_item_ids: z.array(uuid()).optional().default([]),
  })
  .superRefine((value, ctx) => {
    const hasPlanPatch =
      value.name !== undefined ||
      value.description !== undefined ||
      value.visibility !== undefined ||
      value.status !== undefined ||
      value.tags !== undefined ||
      value.estimated_minutes !== undefined ||
      value.org_id !== undefined;
    const hasItemOps = (value.add_items?.length ?? 0) > 0 || (value.remove_item_ids?.length ?? 0) > 0;

    if (!hasPlanPatch && !hasItemOps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No updates provided",
      });
    }
  });

export type PlanListFilterInput = z.infer<typeof PlanListFilterSchema>;
export type InvitedPlanListInput = z.infer<typeof InvitedPlanListSchema>;
export type GetPlanByIdInput = z.infer<typeof GetPlanByIdSchema>;
export type InvitePlanMembersInput = z.infer<typeof InvitePlanMembersSchema>;
export type PlanItemInput = z.infer<typeof PlanItemSchema>;
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

export type PlanItemDto = {
  id: string;
  plan_id: string;
  section_title: string | null;
  section_order: number | null;
  position: number | null;
  item_type: string;
  drill_id: string | null;
  drill_name: string | null;
  title: string | null;
  instructions: string | null;
  sets: number | null;
  reps: number | null;
  duration_min: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  config: Record<string, unknown>;
};

export type PlanDto = {
  id: string;
  org_id: string | null;
  owner_user_id: string;
  name: string;
  description: string | null;
  visibility: string;
  status: string;
  tags: string[];
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
};

export type PlanDetailDto = PlanDto & {
  practice_plan_items: PlanItemDto[];
};

export type InvitedPlanDto = PlanDto & {
  member_role: string;
  invited_at: string;
  invited_by: string | null;
};
