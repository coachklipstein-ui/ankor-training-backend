import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");

const DrillMappingSchema = z.object({
  drill_id: uuid(),
  level: z.number({ coerce: true }).int().optional().nullable(),
});

export const CreateSkillDrillMapSchema = z
  .object({
    org_id: uuid(),
    skill_id: uuid(),
    drill_id: uuid().optional(),
    drill_ids: z.array(uuid()).optional(),
    drills: z.array(DrillMappingSchema).optional(),
    level: z.number({ coerce: true }).int().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const sources = [data.drill_id ? 1 : 0, data.drill_ids?.length ? 1 : 0, data.drills?.length ? 1 : 0].reduce(
      (sum, value) => sum + value,
      0,
    );

    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["drill_id"],
        message: "Provide exactly one of drill_id, drill_ids, or drills",
      });
    }
  });

export const UpdateSkillDrillMapSchema = z
  .object({
    level: z.number({ coerce: true }).int().optional().nullable(),
  })
  .refine((data) => Object.prototype.hasOwnProperty.call(data, "level"), {
    message: "level is required",
    path: ["level"],
  });

export const BulkSkillDrillMapSchema = z
  .object({
    org_id: uuid(),
    skill_id: uuid(),
    add_drill_ids: z.array(uuid()).optional().default([]),
    add_drills: z.array(DrillMappingSchema).optional().default([]),
    remove_drill_ids: z.array(uuid()).optional().default([]),
    level: z.number({ coerce: true }).int().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const hasAdds = data.add_drill_ids.length > 0 || data.add_drills.length > 0;
    const hasRemoves = data.remove_drill_ids.length > 0;

    if (!hasAdds && !hasRemoves) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["add_drill_ids"],
        message: "Provide at least one add_drill_ids, add_drills, or remove_drill_ids entry",
      });
    }
  });

export const SkillDrillMapListSchema = z.object({
  org_id: uuid(),
  skill_id: uuid().optional(),
  drill_id: uuid().optional(),
  limit: z.number({ coerce: true }).int().min(1).max(200).optional().default(50),
  offset: z.number({ coerce: true }).int().min(0).optional().default(0),
});

export const SkillDrillMapBySkillListSchema = SkillDrillMapListSchema.omit({
  org_id: true,
});

export type CreateSkillDrillMapInput = z.infer<typeof CreateSkillDrillMapSchema>;
export type BulkSkillDrillMapInput = z.infer<typeof BulkSkillDrillMapSchema>;
export type UpdateSkillDrillMapInput = z.infer<typeof UpdateSkillDrillMapSchema>;
export type SkillDrillMapListInput = z.infer<typeof SkillDrillMapListSchema>;
export type SkillDrillMapBySkillListInput = z.infer<typeof SkillDrillMapBySkillListSchema>;

export type SkillDrillMapCreateItem = {
  drill_id: string;
  level: number | null;
};

export function normalizeSkillDrillMapCreate(input: CreateSkillDrillMapInput): SkillDrillMapCreateItem[] {
  if (input.drills?.length) {
    return input.drills.map((item) => ({
      drill_id: item.drill_id,
      level: item.level ?? null,
    }));
  }

  if (input.drill_ids?.length) {
    return Array.from(new Set(input.drill_ids)).map((drill_id) => ({
      drill_id,
      level: input.level ?? null,
    }));
  }

  return [
    {
      drill_id: input.drill_id!,
      level: input.level ?? null,
    },
  ];
}

export function normalizeSkillDrillMapBulkCreate(input: BulkSkillDrillMapInput): SkillDrillMapCreateItem[] {
  const byDrillId = new Map<string, SkillDrillMapCreateItem>();

  for (const drill_id of input.add_drill_ids) {
    byDrillId.set(drill_id, {
      drill_id,
      level: input.level ?? null,
    });
  }

  for (const item of input.add_drills) {
    byDrillId.set(item.drill_id, {
      drill_id: item.drill_id,
      level: item.level ?? null,
    });
  }

  return Array.from(byDrillId.values());
}
