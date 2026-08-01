import { z } from "https://esm.sh/zod@3.23.8";
import { RE_UUID } from "../utils/uuid.ts";

const uuid = () => z.string().regex(RE_UUID, "Invalid UUID");
const sha256Hex = () =>
  z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "file_hash must be a SHA-256 hex digest");

export const CreateSkillSchema = z.object({
  org_id: uuid(),
  sport_id: uuid().optional().nullable(),
  category: z.string().trim().min(1, "category is required").max(200),
  title: z.string().trim().min(1, "title is required").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  level: z.string().trim().max(50).optional().nullable(),
  visibility: z.string().trim().max(50).optional().nullable(),
  status: z.string().trim().max(50).optional().nullable(),
});

export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

export const UpdateSkillSchema = z.object({
  sport_id: uuid().optional().nullable(),
  category: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  level: z.string().trim().max(50).optional().nullable(),
  visibility: z.string().trim().max(50).optional().nullable(),
  status: z.string().trim().max(50).optional().nullable(),
});

export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;

export const SkillMediaUploadSchema = z.object({
  org_id: uuid(),
  skill_id: uuid(),
  file_name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).max(120),
  file_hash: sha256Hex().optional(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  thumbnail_url: z.string().url("thumbnail_url must be a valid URL").optional().nullable(),
  position: z.number({ coerce: true }).int().min(0).optional().nullable(),
});

export const SkillMediaCreateSchema = z
  .object({
    org_id: uuid(),
    skill_id: uuid(),
    bucket: z.string().trim().min(1).max(200).optional(),
    object_path: z.string().trim().min(1).max(1024).optional(),
    storage_path: z.string().trim().min(1).max(1024).optional().nullable(),
    url: z.string().url("url must be a valid URL").optional(),
    media_type: z.string().trim().max(50).optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(4000).optional().nullable(),
    thumbnail_url: z.string().url("thumbnail_url must be a valid URL").optional().nullable(),
    position: z.number({ coerce: true }).int().min(0).optional().nullable(),
  })
  .refine((data) => Boolean(data.object_path || data.storage_path || data.url), {
    message: "object_path or url is required",
  });

export type SkillMediaUploadInput = z.infer<typeof SkillMediaUploadSchema>;
export type SkillMediaCreateInput = z.infer<typeof SkillMediaCreateSchema>;

export const SkillMediaBatchItemSchema = z.object({
  file_field: z.string().trim().min(1, "file_field is required").max(100),
  skill_id: uuid(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  thumbnail_url: z.string().url("thumbnail_url must be a valid URL").optional().nullable(),
  position: z.number({ coerce: true }).int().min(0).optional().nullable(),
});

export const SkillMediaBatchSchema = z
  .object({
    org_id: uuid(),
    items: z.array(SkillMediaBatchItemSchema).min(1, "items must contain at least one entry").max(100),
  })
  .superRefine((data, ctx) => {
    const seenFields = new Set<string>();

    for (const [index, item] of data.items.entries()) {
      const field = item.file_field.trim();
      if (seenFields.has(field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "file_field"],
          message: `Duplicate file_field '${field}'`,
        });
        continue;
      }

      seenFields.add(field);
    }
  });

export type SkillMediaBatchItemInput = z.infer<typeof SkillMediaBatchItemSchema>;
export type SkillMediaBatchInput = z.infer<typeof SkillMediaBatchSchema>;

export type SkillMediaUploadResult = {
  bucket: string;
  object_path: string;
  signed_url: string;
  token: string;
  public_url: string;
};

export type SkillMediaRecordDto = {
  id: string;
  skill_id: string;
  bucket: string | null;
  object_path: string;
  url?: string | null;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  position: number | null;
  media_type?: string | null;
};

export type SkillMediaPlaybackDto = {
  media: SkillMediaRecordDto;
  play_url: string;
  expires_in: number | null;
};

export type SkillMediaBatchItemResult = {
  file_field: string;
  file_name: string;
  skill_id: string;
  status: "uploaded" | "skipped" | "failed";
  reason: string | null;
  upload: SkillMediaUploadResult | null;
  media: SkillMediaRecordDto | null;
};

export type SkillMediaBatchResult = {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  items: SkillMediaBatchItemResult[];
};
