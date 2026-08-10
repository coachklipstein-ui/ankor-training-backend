import {
  getOrganizationById,
  listOrganizations,
  updateOrganization,
  type ListOrganizationsFilters,
  type UpdateOrganizationInput,
} from "../services/org.service.ts";
import { registerOrganization } from "../services/signup.organization.service.ts";
import { OrgSignupSchema } from "../schemas/schemas.ts";
import {
  badRequest as httpBadRequest,
  internalError,
  json as httpJson,
  methodNotAllowed,
  notFound,
} from "../utils/http.ts";
import { badRequest, conflict, json, serverError } from "../utils/responses.ts";
import { RE_UUID } from "../utils/uuid.ts";
import { RequestContext } from "../routes/router.ts";

const PROGRAM_GENDERS = ["girls", "boys", "coed"] as const;

export async function handleOrgSignup(req: Request, origin: string | null) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const payload = await req.json().catch(() => null);
  const parsed = OrgSignupSchema.safeParse(payload);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(msg, origin);
  }

  const result = await registerOrganization(parsed.data);
  if (!result.ok) {
    if (result.code === "email_taken") return conflict(result.message, origin);
    if (result.code === "create_user_failed") return badRequest(`Could not create user: ${result.message}`, origin);
    return serverError(`Signup failed: ${result.message}`, origin);
  }

  return json(
    {
      ok: true,
      userId: result.userId,
      orgId: result.orgId,
      profileId: result.profileId,
      teamIds: result.teamIds,
    },
    origin,
    201,
  );
}

function readOptionalString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalInteger(body: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseOffset(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseListOrganizationsFilters(url: URL, adminId: string): { value?: ListOrganizationsFilters; error?: string } {
  const q = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").trim();
  const programGender = (url.searchParams.get("program_gender") ?? url.searchParams.get("programGender") ?? "").trim();
  const sportId = (url.searchParams.get("sport_id") ?? "").trim();

  if (programGender && !PROGRAM_GENDERS.includes(programGender as (typeof PROGRAM_GENDERS)[number])) {
    return { error: "program_gender must be one of: girls, boys, coed" };
  }
  if (sportId && !RE_UUID.test(sportId)) {
    return { error: "sport_id must be a UUID if provided" };
  }

  return {
    value: {
      q: q || undefined,
      program_gender: programGender ? (programGender as ListOrganizationsFilters["program_gender"]) : undefined,
      sport_id: sportId || undefined,
      limit: parseLimit(url.searchParams.get("limit"), 50, 100),
      offset: parseOffset(url.searchParams.get("offset")),
      adminId: adminId,
    },
  };
}

function parseUpdateOrganization(body: unknown): { value?: UpdateOrganizationInput; error?: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON payload" };

  const obj = body as Record<string, unknown>;
  const input: UpdateOrganizationInput = {};

  const name = readOptionalString(obj, "name");
  if (name !== undefined) {
    if (!name) return { error: "name cannot be empty" };
    input.name = name;
  }

  const slug = readOptionalString(obj, "slug");
  if (slug !== undefined) {
    if (!slug) return { error: "slug cannot be empty" };
    input.slug = slug;
  }

  const sportMode = readOptionalString(obj, "sport_mode");
  if (sportMode !== undefined) input.sport_mode = sportMode || null;

  const programGenderRaw = readOptionalString(obj, "program_gender") ?? readOptionalString(obj, "programGender");
  if (programGenderRaw !== undefined) {
    if (!programGenderRaw || !PROGRAM_GENDERS.includes(programGenderRaw as (typeof PROGRAM_GENDERS)[number])) {
      return { error: "program_gender must be one of: girls, boys, coed" };
    }
    input.program_gender = programGenderRaw as UpdateOrganizationInput["program_gender"];
  }

  const sportId = readOptionalString(obj, "sport_id");
  if (sportId !== undefined) {
    if (sportId && !RE_UUID.test(sportId)) return { error: "sport_id must be a UUID if provided" };
    input.sport_id = sportId || null;
  }

  const maxBelow = readOptionalInteger(obj, "maxBelowThresholdRatingsAllowed");
  if ("maxBelowThresholdRatingsAllowed" in obj) {
    if (maxBelow === undefined)
      return { error: "maxBelowThresholdRatingsAllowed must be a non-negative integer or null" };
    input.maxBelowThresholdRatingsAllowed = maxBelow;
  }

  const maxReps = readOptionalInteger(obj, "maxWorkoutReps");
  if ("maxWorkoutReps" in obj) {
    if (maxReps === undefined) return { error: "maxWorkoutReps must be a non-negative integer or null" };
    input.maxWorkoutReps = maxReps;
  }

  if (Object.keys(input).length === 0) return { error: "At least one field is required" };
  return { value: input };
}

export async function listOrganizationsController(req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const parsed = parseListOrganizationsFilters(new URL(req.url), ctx?.user?.id ?? "");
  if (parsed.error || !parsed.value) return httpBadRequest(parsed.error ?? "Invalid filters");

  const { data, count, error } = await listOrganizations(parsed.value);
  if (error) {
    console.error("[listOrganizationsController] list error", error);
    return internalError(error, "Failed to list organizations");
  }

  return httpJson(200, {
    ok: true,
    count,
    limit: parsed.value.limit,
    offset: parsed.value.offset,
    data,
  });
}

export async function getOrganizationByIdController(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const id = params?.id ?? "";
  if (!RE_UUID.test(id)) return httpBadRequest("id (UUID) is required");

  const { data, error } = await getOrganizationById(id);
  if (error) {
    console.error("[getOrganizationByIdController] lookup error", error);
    return internalError(error, "Failed to get organization");
  }
  if (!data) return notFound("Organization not found");

  return httpJson(200, { ok: true, data });
}

export async function updateOrganizationController(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "PATCH") return methodNotAllowed(["PATCH"]);

  const id = params?.id ?? "";
  if (!RE_UUID.test(id)) return httpBadRequest("id (UUID) is required");

  const raw = await req.json().catch(() => null);
  const parsed = parseUpdateOrganization(raw);
  if (parsed.error || !parsed.value) return httpBadRequest(parsed.error ?? "Invalid JSON payload");

  const { data, error } = await updateOrganization(id, parsed.value);
  if (error) {
    console.error("[updateOrganizationController] update error", error);
    return internalError(error, "Failed to update organization");
  }
  if (!data) return notFound("Organization not found");

  return httpJson(200, { ok: true, data });
}
