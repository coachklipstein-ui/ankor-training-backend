// supabase/functions/_shared/controllers/scorecards.ts
import { ScorecardTemplateCreateSchema } from "../schemas/schemas.ts";
import { badRequest, json, notFound, serverError } from "../utils/responses.ts";
import {
  deleteScorecardTemplate,
  getScorecardTemplateById,
  updateScorecardTemplate,
  listScorecardCategoriesByTemplate,
  listScorecardSubskillsByCategory,
  listScorecardTemplates,
  rpcCreateScorecardTemplate,
  type ScorecardCategoryInput,
  type ScorecardSubskillAddInput,
  type ScorecardSubskillInput,
} from "../services/scorecards.service.ts";
import type { RequestContext } from "../routes/router.ts";
import { unauthorized } from "../utils/http.ts";
import { RE_UUID } from "../utils/uuid.ts";

function parseOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new Error(`${field} must be an integer`);
  }
  return num;
}

function parsePosition(value: unknown, field: string): number | undefined {
  const position = parseOptionalInt(value, field);
  if (position !== undefined && position < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return position;
}

function parseRatingMin(value: unknown, field: string): number | undefined {
  const rating = parseOptionalInt(value, field);
  if (rating !== undefined && rating !== 1) {
    throw new Error(`${field} must be 1`);
  }
  return rating;
}

function parseRatingMax(value: unknown, field: string): number | undefined {
  const rating = parseOptionalInt(value, field);
  if (rating !== undefined && rating !== 5) {
    throw new Error(`${field} must be 5`);
  }
  return rating;
}

function parsePriority(value: unknown, field: string): number | undefined {
  const priority = parseOptionalInt(value, field);
  if (priority !== undefined && priority < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return priority;
}

function parseUuidArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !RE_UUID.test(entry.trim())) {
      throw new Error(`${field}[${index}] must be a UUID`);
    }
    return entry.trim();
  });
}

function parseSubskillInput(raw: unknown, fieldPrefix: string): ScorecardSubskillInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${fieldPrefix} must be an object`);
  }

  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) {
    throw new Error(`${fieldPrefix}.name is required`);
  }

  const skill_id = typeof obj.skill_id === "string" ? obj.skill_id.trim() : "";
  if (!RE_UUID.test(skill_id)) {
    throw new Error(`${fieldPrefix}.skill_id (UUID) is required`);
  }

  const description = obj.description === undefined || obj.description === null ? null : String(obj.description).trim();

  const position = parsePosition(obj.position, `${fieldPrefix}.position`);
  const rating_min = parseRatingMin(obj.rating_min, `${fieldPrefix}.rating_min`);
  const rating_max = parseRatingMax(obj.rating_max, `${fieldPrefix}.rating_max`);
  const priority = parsePriority(obj.priority, `${fieldPrefix}.priority`);

  return {
    name,
    description,
    position,
    skill_id,
    rating_min,
    rating_max,
    priority,
  };
}

function parseCategoryInput(raw: unknown, index: number): ScorecardCategoryInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`add_categories[${index}] must be an object`);
  }

  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) {
    throw new Error(`add_categories[${index}].name is required`);
  }

  const description = obj.description === undefined || obj.description === null ? null : String(obj.description).trim();
  const position = parsePosition(obj.position, `add_categories[${index}].position`);

  if (!Array.isArray(obj.subskills) || obj.subskills.length === 0) {
    throw new Error(`add_categories[${index}].subskills must be a non-empty array`);
  }

  const subskills = obj.subskills.map((subskill, subIndex) =>
    parseSubskillInput(subskill, `add_categories[${index}].subskills[${subIndex}]`),
  );

  return {
    name,
    description,
    position,
    subskills,
  };
}

function parseSubskillAddInput(raw: unknown, index: number): ScorecardSubskillAddInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`add_subskills[${index}] must be an object`);
  }

  const obj = raw as Record<string, unknown>;
  const category_id = typeof obj.category_id === "string" ? obj.category_id.trim() : "";
  if (!RE_UUID.test(category_id)) {
    throw new Error(`add_subskills[${index}].category_id (UUID) is required`);
  }

  const parsed = parseSubskillInput(raw, `add_subskills[${index}]`);

  return {
    ...parsed,
    category_id,
  };
}

// ---- Create Template ----
export async function handleScorecardsCreateTemplate(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const raw = await req.json().catch(() => null);
  const normalized = (() => {
    if (!raw || typeof raw !== "object") return raw;
    const body = raw as Record<string, unknown>;
    if (body.categories === undefined && Array.isArray(body.add_categories)) {
      return { ...body, categories: body.add_categories };
    }
    return body;
  })();
  const parsed = ScorecardTemplateCreateSchema.safeParse(normalized);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(msg, origin);
  }
  const body = parsed.data;
  const userId = ctx?.user?.id;
  if (!userId) return unauthorized("Unauthorized");

  // Normalize category/subskill positions
  const categories = body.categories.map((c, i) => ({
    name: c.name.trim(),
    description: c.description ?? null,
    position: Number.isFinite(c.position as any) ? Number(c.position) : i + 1,
    subskills: c.subskills.map((s, j) => ({
      name: s.name.trim(),
      description: s.description ?? null,
      position: Number.isFinite(s.position as any) ? Number(s.position) : j + 1,
      skill_id: s.skill_id,
    })),
  }));

  const payload = {
    org_id: body.org_id,
    sport_id: body.sport_id ?? null,
    name: body.name.trim(),
    description: body.description ?? null,
    isActive: body.isActive ?? true,
    categories,
  };

  const rpcArgs: {
    p_template: unknown;
    p_created_by?: string;
  } = {
    p_template: payload,
    p_created_by: userId,
  };

  const { data: rpcData, error: rpcErr } = await rpcCreateScorecardTemplate(rpcArgs);
  if (rpcErr || !rpcData?.length) {
    const m = rpcErr?.message ?? "RPC returned no data";
    const friendly = m.includes("FORBIDDEN")
      ? "You do not have permission for this organization."
      : m.includes("CATEGORY_NEEDS_ONE_SUBSKILL")
        ? "Each category must have at least one subskill."
        : m.includes("SUBSKILL_SKILL_REQUIRED")
          ? "Each subskill must include a valid skill_id."
          : m.includes("SUBSKILL_SKILL_NOT_IN_ORG_OR_SPORT")
            ? "One or more skills do not belong to this org/sport."
            : m.includes("AT_LEAST_ONE_CATEGORY_REQUIRED")
              ? "At least one category is required."
              : m.includes("NAME_REQUIRED")
                ? "Template name is required."
                : m.includes("ORG_REQUIRED")
                  ? "org_id is required."
                  : null;

    return serverError(friendly ?? `Failed to create template: ${m}`, origin);
  }

  const result = rpcData[0];
  return json({ ok: true, templateId: result.template_id }, origin, 201);
}

// ---- List Templates ----
export async function handleScorecardsList(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  const sport_id = (url.searchParams.get("sport_id") ?? "").trim() || undefined;
  const q = (url.searchParams.get("q") ?? "").trim() || undefined;

  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "10", 10) || 10, 1), 200);
  const offset = Math.max(parseInt(offsetRaw ?? "0", 10) || 0, 0);

  if (!org_id) return badRequest("org_id (UUID) is required", origin);

  const { data, count, error } = await listScorecardTemplates({
    org_id,
    sport_id,
    q,
    limit,
    offset,
  });

  if (error) return serverError(error.message, origin);
  return json({ ok: true, count, items: data ?? [] }, origin, 200);
}

// ---- Get Template By Id ----
export async function handleScorecardById(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const template_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(template_id)) {
    return badRequest("id (UUID) is required", origin);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required", origin);
  }

  const { data, error } = await getScorecardTemplateById({
    org_id,
    template_id,
  });

  if (error) return serverError(error.message, origin);
  if (!data) return notFound("Scorecard template not found", origin);

  return json({ ok: true, item: data }, origin, 200);
}

// ---- Update Template ----
export async function handleScorecardUpdate(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "PATCH") return badRequest("Method not allowed", origin);

  const template_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(template_id)) {
    return badRequest("id (UUID) is required", origin);
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid JSON payload", origin);
  }

  try {
    const body = payload as Record<string, unknown>;
    const org_id = typeof body.org_id === "string" ? body.org_id.trim() : (ctx?.org_id ?? "");

    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required", origin);
    }

    const add_categories = Array.isArray(body.add_categories)
      ? body.add_categories.map((category, index) => parseCategoryInput(category, index))
      : [];
    const remove_category_ids = parseUuidArray(body.remove_category_ids, "remove_category_ids");
    const add_subskills = Array.isArray(body.add_subskills)
      ? body.add_subskills.map((subskill, index) => parseSubskillAddInput(subskill, index))
      : [];
    const remove_subskill_ids = parseUuidArray(body.remove_subskill_ids, "remove_subskill_ids");

    if (
      add_categories.length === 0 &&
      remove_category_ids.length === 0 &&
      add_subskills.length === 0 &&
      remove_subskill_ids.length === 0
    ) {
      return badRequest("At least one update action is required", origin);
    }

    const {
      data,
      error,
      notFound: missing,
    } = await updateScorecardTemplate({
      org_id,
      template_id,
      add_categories,
      remove_category_ids,
      add_subskills,
      remove_subskill_ids,
    });

    if (missing) return notFound("Scorecard template not found", origin);

    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      return serverError(message, origin);
    }

    return json({ ok: true, ...data }, origin, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return badRequest(message, origin);
  }
}

// ---- Delete Template ----
export async function handleScorecardDelete(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "DELETE") return badRequest("Method not allowed", origin);

  const template_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(template_id)) {
    return badRequest("id (UUID) is required", origin);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required", origin);
  }

  const {
    data,
    error,
    notFound: missing,
  } = await deleteScorecardTemplate({
    org_id,
    template_id,
  });

  if (missing) return notFound("Scorecard template not found", origin);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return serverError(message, origin);
  }

  return json({ ok: true, deleted: data }, origin, 200);
}

/**
 * GET /api/scorecard/categories?scorecard_template_id=<UUID>
 */
export async function handleScorecardCategoriesByTemplate(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  const scorecard_template_id = (url.searchParams.get("scorecard_template_id") ?? "").trim();

  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(offsetRaw ?? "0", 10) || 0, 0);

  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required", origin);
  }

  if (!scorecard_template_id) {
    return badRequest("scorecard_template_id (UUID) is required", origin);
  }

  const { data, count, error } = await listScorecardCategoriesByTemplate({
    org_id,
    scorecard_template_id,
    limit,
    offset,
  });

  if (error) return serverError(error.message, origin);

  return json({ ok: true, count, items: data ?? [] }, origin, 200);
}

export async function handleScorecardSubskillsByCategory(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  const category_id = (url.searchParams.get("category_id") ?? "").trim();

  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(offsetRaw ?? "0", 10) || 0, 0);

  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required", origin);
  }

  if (!category_id) {
    return badRequest("category_id (UUID) is required", origin);
  }

  const { data, count, error } = await listScorecardSubskillsByCategory({
    org_id,
    category_id,
    limit,
    offset,
  });

  if (error) return serverError(error.message, origin);

  return json({ ok: true, count, items: data ?? [] }, origin, 200);
}
