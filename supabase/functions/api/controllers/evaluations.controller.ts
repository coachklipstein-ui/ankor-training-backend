import { EvaluationInput, EvaluationItemInput } from "../schemas/evaluations.ts";
import {
  rpcBulkCreateEvaluations,
  listEvaluations,
  listLatestEvaluationsByAthlete,
  listEvaluationAthletesById,
  listEvaluationImprovementSkills,
  listEvaluationSkillVideos,
  listEvaluationSubskillRatings,
  getEvaluationWorkoutSummary,
  listEvaluationWorkoutProgress,
  incrementEvaluationWorkoutProgress,
  listEvaluationWorkoutDrills,
  listLatestEvaluationWorkoutDrills,
  getEvaluationById,
  deleteEvaluation,
  applyEvaluationMatrixUpdateService,
  submitEvaluation,
  buildEvaluationReportEmailInputs,
} from "../services/evaluations.service.ts";
import { sendBulkEvaluationReportEmails } from "../services/email.service.ts";
import { badRequest, created, internalError, methodNotAllowed, json } from "../utils/http.ts";
import { EvaluationDetailDto, type EvaluationMatrixUpdateDto } from "../dtos/evaluations.dto.ts";
import { jsonResponse } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatEvaluationDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const month = parts.find((p) => p.type === "month")?.value?.toUpperCase() ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value?.toUpperCase() ?? "";

  if (!month || !day || !year || !hour || !minute || !dayPeriod) {
    return null;
  }

  return `${month} ${day}, ${year} AT ${hour}:${minute} ${dayPeriod}`;
}

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDateInput(value: string, boundary: "start" | "end"): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  if (DATE_ONLY_RE.test(trimmed)) {
    if (boundary === "start") {
      parsed.setUTCHours(0, 0, 0, 0);
    } else {
      parsed.setUTCHours(23, 59, 59, 999);
    }
  }

  return parsed.toISOString();
}

/**
 * Validate a single evaluation item
 * Now requires athlete_id on each item.
 */
function parseEvaluationItem(raw: unknown, evalIndex: number, itemIndex: number): EvaluationItemInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`evaluations[${evalIndex}].evaluation_items[${itemIndex}] must be an object`);
  }

  const item = raw as Record<string, unknown>;

  if (!item.athlete_id || typeof item.athlete_id !== "string") {
    throw new Error(`evaluations[${evalIndex}].evaluation_items[${itemIndex}].athlete_id is required (string)`);
  }

  if (!item.skill_id || typeof item.skill_id !== "string") {
    throw new Error(`evaluations[${evalIndex}].evaluation_items[${itemIndex}].skill_id is required (string)`);
  }

  if (typeof item.rating !== "number" || !Number.isFinite(item.rating)) {
    throw new Error(`evaluations[${evalIndex}].evaluation_items[${itemIndex}].rating must be a number`);
  }

  // Optional: enforce rating range 1–5 (DB constraint was removed, we keep it in app layer)
  if (item.rating < 1 || item.rating > 5) {
    throw new Error(`evaluations[${evalIndex}].evaluation_items[${itemIndex}].rating must be between 1 and 5`);
  }

  return {
    athlete_id: item.athlete_id,
    skill_id: item.skill_id,
    rating: item.rating,
    comments: item.comments === undefined || item.comments === null ? null : String(item.comments),
  };
}

/**
 * Validate a single evaluation
 *
 * Note:
 * - No athlete_id at this level anymore.
 * - Optional team_id.
 * - Athletes are per item via evaluation_items[].athlete_id.
 */
function parseEvaluation(raw: unknown, index: number): EvaluationInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`evaluations[${index}] must be an object`);
  }

  const obj = raw as Record<string, unknown>;

  const requiredFields: Array<keyof EvaluationInput> = [
    "org_id",
    "scorecard_template_id",
    "coach_id",
    "evaluation_items",
  ];

  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new Error(`evaluations[${index}].${field} is required`);
    }
  }

  if (!Array.isArray(obj.evaluation_items) || obj.evaluation_items.length === 0) {
    throw new Error(`evaluations[${index}].evaluation_items must be a non-empty array`);
  }

  const items: EvaluationItemInput[] = obj.evaluation_items.map((item: unknown, itemIndex: number) =>
    parseEvaluationItem(item, index, itemIndex),
  );

  const team_id = obj.team_id === undefined || obj.team_id === null || obj.team_id === "" ? null : String(obj.team_id);

  return {
    org_id: String(obj.org_id),
    scorecard_template_id: String(obj.scorecard_template_id),
    team_id,
    coach_id: String(obj.coach_id),
    notes: obj.notes === undefined || obj.notes === null ? null : String(obj.notes),
    evaluation_items: items,
  };
}

/**
 * Controller: POST /api/evaluations/bulk-create
 */
export async function bulkCreateEvaluationsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    const body = await req.json().catch(() => null);

    if (!body || !Array.isArray(body.evaluations)) {
      return badRequest("Body must contain an 'evaluations' array.");
    }

    // ✅ Validate + normalize payload into EvaluationInput[]
    const evaluations: EvaluationInput[] = body.evaluations.map((rawEval: unknown, index: number) =>
      parseEvaluation(rawEval, index),
    );

    // 🔁 Call RPC service (evaluations_bulk_create_tx)
    const { data, error } = await rpcBulkCreateEvaluations({ evaluations });

    if (error) {
      console.error("[bulkCreateEvaluationsController] rpc error", error);
      return internalError(error);
    }

    const createdEvaluations = (data ?? []) as unknown[];

    return created({
      ok: true,
      count: createdEvaluations.length,
      data: createdEvaluations,
    });
  } catch (err) {
    console.error("[bulkCreateEvaluationsController] error", err);
    return internalError(err);
  }
}

/**
 * GET /api/evaluations/list
 * Returns ONLY evaluations
 */
export async function handleEvaluationsList(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    const { data, error } = await listEvaluations(org_id || undefined);

    if (error) {
      console.error("[handleEvaluationsList] list error", error);
      return internalError(error);
    }

    const evaluations = data ?? [];

    return json(200, {
      ok: true,
      count: evaluations.length,
      data: evaluations,
    });
  } catch (err) {
    console.error("[handleEvaluationsList] error", err);
    return internalError(err);
  }
}

export async function handleLatestEvaluations(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athleteIdRaw = (url.searchParams.get("athlete_id") ?? "").trim();
    const athlete_id = athleteIdRaw ? athleteIdRaw : undefined;
    if (athlete_id && !RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const coachParam = qp(url, "coach");
    const coach_name = qp(url, "coach_name") ?? (coachParam && !RE_UUID.test(coachParam) ? coachParam : undefined);
    const coach_id = qp(url, "coach_id") ?? (coachParam && RE_UUID.test(coachParam) ? coachParam : undefined);

    const scorecard_name = qp(url, "scorecard_name");
    const athlete_name = qp(url, "athlete_name");

    if (coach_id && !RE_UUID.test(coach_id)) {
      return badRequest("coach_id (UUID) is required");
    }

    const dateFromRaw = qp(url, "date_from");
    const dateToRaw = qp(url, "date_to");
    const dateRaw = qp(url, "date");

    let date_from = dateFromRaw ? normalizeDateInput(dateFromRaw, "start") : undefined;
    let date_to = dateToRaw ? normalizeDateInput(dateToRaw, "end") : undefined;

    if (dateFromRaw && !date_from) {
      return badRequest("date_from must be a valid date");
    }
    if (dateToRaw && !date_to) {
      return badRequest("date_to must be a valid date");
    }

    if (dateRaw && !dateFromRaw && !dateToRaw) {
      const start = normalizeDateInput(dateRaw, "start");
      const end = normalizeDateInput(dateRaw, "end");
      if (!start || !end) {
        return badRequest("date must be a valid date");
      }
      date_from = start;
      date_to = end;
    }

    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const { data, count, error } = await listLatestEvaluationsByAthlete({
      org_id,
      athlete_id,
      user_id: ctx?.org_role === "parent" ? ctx?.user?.id : undefined,
      coach_id,
      coach_name,
      athlete_name,
      scorecard_name,
      date_from,
      date_to,
      limit,
      offset,
    });

    if (error) {
      console.error("[handleLatestEvaluations] list error", error);
      return internalError(error);
    }

    const items = data.map((item) => ({
      evaluation_id: item.evaluation_id,
      date: formatEvaluationDate(item.created_at),
      scorecard_name: item.scorecard_name,
      coach_name: item.coach_name,
      athlete_id: item.athlete_id,
      athlete_full_name: item.athlete_full_name,
    }));

    return json(200, {
      ok: true,
      count,
      data: items,
    });
  } catch (err) {
    console.error("[handleLatestEvaluations] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationAthletesById(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (athlete_id && !RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    if (evaluation_id && !RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    if (!evaluation_id) {
      if (!athlete_id) {
        return badRequest("evaluation_id or athlete_id (UUID) is required");
      }

      const { data, count, error } = await listLatestEvaluationsByAthlete({
        org_id,
        athlete_id,
        user_id: ctx?.org_role === "parent" ? ctx?.user?.id : undefined,
        limit,
        offset,
      });

      if (error) {
        console.error("[handleEvaluationAthletesById] list error", error);
        return internalError(error);
      }

      const items = data.map((item) => ({
        evaluation_id: item.evaluation_id,
        date: formatEvaluationDate(item.created_at),
        scorecard_name: item.scorecard_name,
        coach_name: item.coach_name,
        athlete_id: item.athlete_id,
        athlete_full_name: item.athlete_full_name,
        athletes_name: item.athlete_full_name,
      }));

      return json(200, {
        ok: true,
        count,
        data: items,
      });
    }

    const { data, count, error } = await listEvaluationAthletesById({
      org_id,
      evaluation_id,
      athlete_id: athlete_id || undefined,
      limit,
      offset,
    });

    if (error) {
      console.error("[handleEvaluationAthletesById] list error", error);
      return internalError(error);
    }

    const items = data.map((item) => ({
      evaluation_id: item.evaluation_id,
      date: formatEvaluationDate(item.created_at),
      scorecard_name: item.scorecard_name,
      coach_name: item.coach_name,
      athlete_id: item.athlete_id,
      athlete_full_name: item.athlete_full_name,
      athletes_name: item.athletes_name,
    }));

    return json(200, {
      ok: true,
      count,
      data: items,
    });
  } catch (err) {
    console.error("[handleEvaluationAthletesById] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationImprovementSkills(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 3;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const { data, count, error } = await listEvaluationImprovementSkills({
      org_id,
      evaluation_id,
      athlete_id,
      limit,
      offset,
      rating_max: 3,
    });

    if (error) {
      console.error("[handleEvaluationImprovementSkills] list error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      count,
      data,
    });
  } catch (err) {
    console.error("[handleEvaluationImprovementSkills] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationSkillVideos(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const { data, count, error } = await listEvaluationSkillVideos({
      org_id,
      evaluation_id,
      athlete_id,
      rating_max: 3,
    });

    if (error) {
      console.error("[handleEvaluationSkillVideos] list error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      count,
      data,
    });
  } catch (err) {
    console.error("[handleEvaluationSkillVideos] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationSubskillRatings(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const { data, count, error } = await listEvaluationSubskillRatings({
      org_id,
      evaluation_id,
      athlete_id,
      rating_max: 3,
    });

    if (error) {
      console.error("[handleEvaluationSubskillRatings] list error", error);
      return internalError(error);
    }

    const grouped = new Map<
      string,
      { id: string; name: string; subskills: Array<{ id: string; name: string; score: number }> }
    >();

    for (const row of data) {
      if (!row.category_id) continue;
      const categoryName = row.category_descrip ?? "";
      let category = grouped.get(row.category_id);
      if (!category) {
        category = {
          id: row.category_id,
          name: categoryName,
          subskills: [],
        };
        grouped.set(row.category_id, category);
      }

      const score = typeof row.rating === "number" && Number.isFinite(row.rating) ? row.rating : null;
      if (score === null) continue;
      if (!row.skill_id) continue;

      category.subskills.push({
        id: row.skill_id,
        name: row.skill_descrip ?? "",
        score,
      });
    }

    const payload = Array.from(grouped.values());

    return json(200, {
      ok: true,
      count: payload.length,
      data: payload,
    });
  } catch (err) {
    console.error("[handleEvaluationSubskillRatings] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationWorkoutSummary(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const user_id = ctx?.user?.id ?? "";
    if (!RE_UUID.test(user_id)) {
      return badRequest("user_id (UUID) is required");
    }

    const { data, error } = await getEvaluationWorkoutSummary({
      org_id,
      athlete_id,
      user_id,
    });

    if (error) {
      console.error("[handleEvaluationWorkoutSummary] error", error);
      return internalError(error);
    }
    return json(200, {
      ok: true,
      data: data ?? { total_evals: 0, total_reps: 0, total_plans_shares: 0 },
    });
  } catch (err) {
    console.error("[handleEvaluationWorkoutSummary] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationWorkoutProgress(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const { data, count, error } = await listEvaluationWorkoutProgress({
      org_id,
      athlete_id,
      evaluation_id,
      limit,
      offset,
    });

    if (error) {
      console.error("[handleEvaluationWorkoutProgress] list error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      count,
      data,
    });
  } catch (err) {
    console.error("[handleEvaluationWorkoutProgress] error", err);
    return internalError(err);
  }
}

export async function handleIncrementWorkoutProgress(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const { data, error } = await incrementEvaluationWorkoutProgress({
      org_id,
      athlete_id,
      evaluation_id,
    });

    if (error) {
      const message = error instanceof Error ? error.message : "Internal Server Error";
      if (message.toLowerCase().includes("not found")) {
        return jsonResponse({ ok: false, error: message }, { status: 404 });
      }
      if (message.toLowerCase().includes("maxworkoutreps")) {
        return badRequest(message);
      }
      console.error("[handleIncrementWorkoutProgress] error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      data,
    });
  } catch (err) {
    console.error("[handleIncrementWorkoutProgress] error", err);
    return internalError(err);
  }
}

export async function handleEvaluationWorkoutDrills(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    let evaluation_id = (params?.id ?? "").trim();
    if (!evaluation_id) {
      evaluation_id = (url.searchParams.get("evaluation_id") ?? "").trim();
    }
    if (!RE_UUID.test(evaluation_id)) {
      return badRequest("evaluation_id (UUID) is required");
    }

    const { data, count, error } = await listEvaluationWorkoutDrills({
      org_id,
      athlete_id,
      evaluation_id,
    });

    if (error) {
      console.error("[handleEvaluationWorkoutDrills] error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      count,
      data,
    });
  } catch (err) {
    console.error("[handleEvaluationWorkoutDrills] error", err);
    return internalError(err);
  }
}

export async function handleLatestEvaluationWorkoutDrills(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const athlete_id = (url.searchParams.get("athlete_id") ?? "").trim();
    if (!RE_UUID.test(athlete_id)) {
      return badRequest("athlete_id (UUID) is required");
    }

    const { data, count, error } = await listLatestEvaluationWorkoutDrills({
      org_id,
      athlete_id,
    });

    if (error) {
      console.error("[handleLatestEvaluationWorkoutDrills] error", error);
      return internalError(error);
    }

    return json(200, {
      ok: true,
      count,
      data,
    });
  } catch (err) {
    console.error("[handleLatestEvaluationWorkoutDrills] error", err);
    return internalError(err);
  }
}

// Handler for GET /api/evaluations/eval/:id
export async function handleEvaluationById(
  req: Request,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  let id = params?.id;

  if (!id) {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    id = segments[segments.length - 1];
  }

  if (!id) {
    return jsonResponse({ ok: false, error: "Missing 'id' path parameter" }, { status: 400 });
  }

  try {
    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const evaluation: EvaluationDetailDto | null = await getEvaluationById(id, org_id);

    if (!evaluation) {
      return jsonResponse({ ok: false, error: "Evaluation not found" }, { status: 404 });
    }

    return jsonResponse({ ok: true, evaluation }, { status: 200 });
  } catch (err) {
    console.error("[handleEvaluationById] Unexpected error", err);
    return jsonResponse({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function handleDeleteEvaluation(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "DELETE") {
      return methodNotAllowed(["DELETE"]);
    }

    const id = (params?.id ?? "").trim();
    if (!RE_UUID.test(id)) {
      return badRequest("id (UUID) is required");
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const { data, error } = await deleteEvaluation(id, org_id);
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return jsonResponse({ ok: false, error: "Evaluation not found" }, { status: 404 });
      }
      console.error("[handleDeleteEvaluation] delete error", error);
      return internalError(error, "Failed to delete evaluation");
    }

    return json(200, { ok: true, deleted: data });
  } catch (err) {
    console.error("[handleDeleteEvaluation] Unexpected error", err);
    return internalError(err, "Failed to delete evaluation");
  }
}

export async function updateEvaluationMatrixController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const evaluationId = segments[segments.length - 2]; // ✅ UUID before "matrix"

    if (!evaluationId) {
      return jsonResponse({ ok: false, error: "Missing evaluation id in path" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as EvaluationMatrixUpdateDto | null;

    if (!body || !Array.isArray(body.operations)) {
      return jsonResponse({ ok: false, error: "Body must include an 'operations' array" }, { status: 400 });
    }

    if (!body.org_id || typeof body.org_id !== "string" || !RE_UUID.test(body.org_id)) {
      return jsonResponse({ ok: false, error: "org_id (UUID) is required" }, { status: 400 });
    }

    if (body.operations.length === 0) {
      return jsonResponse({ ok: false, error: "'operations' array must not be empty" }, { status: 400 });
    }

    const payload: EvaluationMatrixUpdateDto = {
      ...body,
      evaluation_id: evaluationId,
    };

    const evaluation = await applyEvaluationMatrixUpdateService(payload);

    return jsonResponse({ ok: true, evaluation }, { status: 200 });
  } catch (err: any) {
    console.error("[updateEvaluationMatrixController] error", err);
    const message = typeof err?.message === "string" ? err.message : "Internal server error";
    return jsonResponse({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/evaluations/eval/:id/submit
 * Submits an evaluation (currently marks as completed; later can run more steps).
 */
export async function handleSubmitEvaluation(
  req: Request,
  params?: { id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    // Prefer params if your router provides them
    let id = params?.id;

    // Fallback: derive from URL
    if (!id) {
      const url = new URL(req.url);
      const segments = url.pathname.split("/").filter(Boolean);

      // If last segment is "submit", id is previous; otherwise last
      const last = segments[segments.length - 1];
      id = last === "submit" ? segments[segments.length - 2] : last;
    }

    if (!id) {
      return jsonResponse({ ok: false, error: "Missing 'id' path parameter" }, { status: 400 });
    }
    if (!RE_UUID.test(id)) {
      return jsonResponse({ ok: false, error: "id (UUID) is required" }, { status: 400 });
    }

    const url = new URL(req.url);
    const org_id = (url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return jsonResponse({ ok: false, error: "org_id (UUID) is required" }, { status: 400 });
    }

    const result = await submitEvaluation(id, org_id);

    if (!result.ok) {
      const message = result.error instanceof Error ? result.error.message : "Failed to submit evaluation";

      if (message.toLowerCase().includes("not found")) {
        return jsonResponse({ ok: false, error: message }, { status: 404 });
      }

      return jsonResponse({ ok: false, error: message }, { status: 500 });
    }

    try {
      const { data: emailItems, error: emailError } = await buildEvaluationReportEmailInputs(id, org_id);

      if (emailError) {
        console.error("[handleSubmitEvaluation] email build error", emailError);
      } else if (emailItems.length > 0) {
        const emailResult = await sendBulkEvaluationReportEmails(emailItems);
        if (emailResult.failed.length > 0) {
          console.error("[handleSubmitEvaluation] email send failures", emailResult.failed);
        }
      }
    } catch (emailErr) {
      console.error("[handleSubmitEvaluation] email send error", emailErr);
    }

    return jsonResponse({ ok: true, data: result.data }, { status: 200 });
  } catch (err) {
    console.error("[handleSubmitEvaluation] Unexpected error", err);
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Internal server error";
    return jsonResponse({ ok: false, error: message }, { status: 500 });
  }
}
