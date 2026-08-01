import { sbAdmin } from "../services/supabase.ts";
import {
  getOrganizationById,
  listOrganizations,
  updateOrganization,
  type ListOrganizationsFilters,
  type UpdateOrganizationInput,
} from "../services/org.service.ts";
import {
  badRequest as httpBadRequest,
  internalError,
  json as httpJson,
  methodNotAllowed,
  notFound,
} from "../utils/http.ts";
import { badRequest, json, serverError } from "../utils/responses.ts";
import { RE_UUID } from "../utils/uuid.ts";

type Body = {
  admin: { firstName: string; lastName: string; email: string; phone?: string | null; password: string };
  organization: { name: string; programGender: "girls" | "boys" | "coed"; sport_id?: string | null };
  sport_id?: string | null;
  teams?: Array<{ name: string }>;
};

const PROGRAM_GENDERS = ["girls", "boys", "coed"] as const;

export async function handleOrgSignup(req: Request, origin: string | null) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest("Invalid JSON body", origin);

  const admin = body.admin;
  const org = body.organization;
  const teams = body.teams ?? [];
  if (!admin?.firstName || !admin?.lastName || !admin?.email || !admin?.password) {
    return badRequest("Missing admin fields", origin);
  }
  if (!org?.name || !PROGRAM_GENDERS.includes(org.programGender)) {
    return badRequest("Invalid organization data", origin);
  }
  const sportId = (org.sport_id ?? body.sport_id)?.trim() || null;
  if (sportId && !RE_UUID.test(sportId)) {
    return badRequest("sport_id must be a UUID if provided", origin);
  }

  const { data: created, error: createErr } = await sbAdmin!.auth.admin.createUser({
    email: admin.email,
    password: admin.password,
    email_confirm: true,
    user_metadata: {
      first_name: admin.firstName,
      last_name: admin.lastName,
      role: "admin",
    },
  });
  if (createErr || !created?.user) {
    return badRequest(`Could not create user: ${createErr?.message}`, origin);
  }

  const userId = created.user.id;
  const teamNames = teams.map((t) => t?.name?.trim()).filter(Boolean);

  const rpcArgs = {
    p_user_id: userId,
    p_first_name: admin.firstName,
    p_last_name: admin.lastName,
    p_email: admin.email,
    p_phone: admin.phone ?? null,
    p_org_name: org.name,
    p_program_gender: org.programGender,
    p_team_names: teamNames,
    p_sport_id: sportId,
  };

  let { data: rpcData, error: rpcErr } = await sbAdmin!.rpc("signup_register_org_tx", rpcArgs);

  const rpcMessage = String(rpcErr?.message ?? "").toLowerCase();
  const shouldRetryWithoutSportId =
    Boolean(rpcErr) &&
    rpcMessage.includes("could not find the function") &&
    rpcMessage.includes("signup_register_org_tx") &&
    rpcMessage.includes("p_sport_id");

  if (shouldRetryWithoutSportId) {
    const { p_sport_id: _sportId, ...legacyRpcArgs } = rpcArgs;
    const legacyResult = await sbAdmin!.rpc("signup_register_org_tx", legacyRpcArgs);
    rpcData = legacyResult.data;
    rpcErr = legacyResult.error;

    const createdOrgId = Array.isArray(rpcData) ? rpcData[0]?.org_id : null;
    if (!rpcErr && sportId && createdOrgId) {
      const { error: sportUpdateErr } = await sbAdmin!
        .from("organizations")
        .update({ sport_id: sportId })
        .eq("id", createdOrgId);

      if (sportUpdateErr) {
        await sbAdmin!.auth.admin.deleteUser(userId).catch(() => {});
        return serverError(`Signup failed: ${sportUpdateErr.message}`, origin);
      }
    }
  }

  if (rpcErr || !rpcData?.length) {
    await sbAdmin!.auth.admin.deleteUser(userId).catch(() => {});
    return serverError(`Signup failed: ${rpcErr?.message ?? "RPC returned no data"}`, origin);
  }

  const result = rpcData[0];
  return json(
    { ok: true, userId, orgId: result.org_id, profileId: result.profile_id, teamIds: result.team_ids ?? [] },
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

function parseListOrganizationsFilters(url: URL): { value?: ListOrganizationsFilters; error?: string } {
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

export async function listOrganizationsController(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const parsed = parseListOrganizationsFilters(new URL(req.url));
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
