import { SignUpSchema } from "../schemas/schemas.ts";
import { json, badRequest, conflict, notFound, serverError } from "../utils/responses.ts";
import { AuthLoginSchema } from "../schemas/schemas.ts";
import { sbAdmin, sbAnon } from "../services/supabase.ts";
import { rpcRegisterAthlete, rpcRegisterCoach, rpcRegisterParent } from "../services/signup.service..ts";
import {
  generateInviteLink,
  generateMagicLink,
  sendWelcomeEmail,
  sendBulkEvaluationReportEmails,
  type EvaluationReportEmailInput,
} from "../services/email.service.ts";

export async function handleAuthSignup(req: Request, origin: string | null) {
  if (req.method !== "POST") return badRequest("Use POST", origin);

  const payload = await req.json().catch(() => null);
  const parsed = SignUpSchema.safeParse(payload);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(msg, origin);
  }
  const base = parsed.data as any; // athlete | coach | parent
  const positionId = base.role === "athlete" && typeof base.position_id === "string" ? base.position_id.trim() : "";

  // Create auth user
  const { data: created, error: createErr } = await sbAdmin!.auth.admin.createUser({
    email: base.email,
    password: base.password,
    user_metadata: {
      first_name: base.firstName,
      last_name: base.lastName,
      username: base.username ?? null,
      cell_number: base.cellNumber ?? null,
      join_code: base.joinCode,
      ...(base.role === "athlete" ? { graduation_year: base.graduationYear, position_id: positionId || null } : {}),
    },
    app_metadata: { role: base.role },
    email_confirm: true,
  });

  if (createErr) {
    const m = String(createErr.message).toLowerCase();
    if (m.includes("user already registered")) return conflict("Email already registered", origin);
    return serverError(`Failed to create user: ${createErr.message}`, origin);
  }
  const userId = created.user?.id;
  if (!userId) return serverError("User was not returned by Supabase", origin);

  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  try {
    if (base.role === "athlete") {
      const positionIds = positionId ? [positionId] : [];

      rpcName = "signup_register_athlete_with_code_tx";
      rpcArgs = {
        p_user_id: userId,
        p_code: base.joinCode,
        p_first_name: base.firstName,
        p_last_name: base.lastName,
        p_email: base.email,
        p_graduation_year: base.graduationYear,
        p_cell_number: base.cellNumber ?? null,
        p_positions: positionIds,
        p_terms_accepted: true,
      };
      var { data: txData, error: txErr } = await rpcRegisterAthlete(rpcArgs);
    } else if (base.role === "coach") {
      rpcName = "signup_register_coach_with_code_tx";
      rpcArgs = {
        p_user_id: userId,
        p_code: base.joinCode,
        p_first_name: base.firstName,
        p_last_name: base.lastName,
        p_email: base.email,
        p_cell_number: base.cellNumber ?? null,
        p_terms_accepted: true,
      };
      var { data: txData, error: txErr } = await rpcRegisterCoach(rpcArgs);
    } else {
      rpcName = "signup_register_parent_with_code_tx";
      rpcArgs = {
        p_user_id: userId,
        p_code: base.joinCode,
        p_first_name: base.firstName,
        p_last_name: base.lastName,
        p_email: base.email,
        p_cell_number: base.cellNumber ?? null,
        p_terms_accepted: true,
      };
      var { data: txData, error: txErr } = await rpcRegisterParent(rpcArgs);
    }

    if (txErr) throw txErr;

    const out = Array.isArray(txData) && txData[0] ? txData[0] : {};

    try {
      const fullName = [base.firstName, base.lastName]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .join(" ");
      const { actionLink } = await generateMagicLink(base.email, {
        data: { role: base.role, user_id: userId },
      });
      await sendWelcomeEmail(base.email, fullName || null, actionLink);
    } catch (emailErr) {
      console.error("[handleAuthSignup] welcome email failed", emailErr);
    }

    return json({ ok: true, user_id: userId, role: base.role, ...out, message: "Welcome to ANKOR!" }, origin, 201);
  } catch (e) {
    // rollback auth user
    await sbAdmin!.auth.admin.deleteUser(userId).catch(() => {});
    const m = String((e as any)?.message ?? e);
    if (m.includes("INVALID_JOIN_CODE") || m.includes("EXPIRED_OR_USED_JOIN_CODE"))
      return badRequest("Invalid or expired join code.", origin);
    if (m.includes("TERMS_REQUIRED")) return badRequest("You must accept the terms & conditions.", origin);
    if (m.includes("GRADUATION_YEAR_REQUIRED")) return badRequest("Graduation year is required.", origin);
    if (m.includes("POSITION_REQUIRED")) return badRequest("At least one position is required.", origin);
    if (m.includes("FIRST_NAME_REQUIRED")) return badRequest("First name is required.", origin);
    if (m.includes("LAST_NAME_REQUIRED")) return badRequest("Last name is required.", origin);
    if (m.includes("EMAIL_REQUIRED")) return badRequest("Valid email is required.", origin);
    return serverError(`Signup failed: ${m}`, origin);
  }
}

export async function handleAuthLogin(req: Request, origin: string | null) {
  if (req.method !== "POST") return badRequest("Use POST", origin);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid JSON body", origin);
  }

  const body = payload as Record<string, unknown>;
  const userIdRaw =
    typeof body.user_id === "string"
      ? body.user_id
      : typeof body.userId === "string"
        ? body.userId
        : typeof body.userid === "string"
          ? body.userid
          : "";
  const parsed = AuthLoginSchema.safeParse({ user_id: userIdRaw.trim() });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(msg, origin);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ ok: false, error: "Missing bearer token" }, origin, 401);
  }
  const token = match[1].trim();
  if (!token) {
    return json({ ok: false, error: "Missing bearer token" }, origin, 401);
  }

  if (!sbAnon) return serverError("Auth client not configured", origin);

  const { data: authData, error: authErr } = await sbAnon.auth.getUser(token);
  if (authErr || !authData?.user) {
    return json({ ok: false, error: "Invalid or expired token" }, origin, 401);
  }
  if (authData.user.id !== parsed.data.user_id) {
    return json({ ok: false, error: "Token does not match user" }, origin, 401);
  }

  if (!sbAdmin) return serverError("Database client not configured", origin);

  const { data: profile, error: profileErr } = await sbAdmin
    .from("profiles")
    .select("id, email, full_name, role, default_org_id")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  if (profileErr) {
    return serverError(`Failed to load profile: ${profileErr.message}`, origin);
  }
  if (!profile) return notFound("Profile not found", origin);

  const profileUserId = typeof profile.id === "string" ? profile.id.trim() : "";
  const profileOrgId = typeof profile.default_org_id === "string" ? profile.default_org_id.trim() : "";
  let effectiveRole = profile.role ?? null;

  if (profileOrgId && profileUserId && effectiveRole !== "parent") {
    const { data: athleteRow, error: athleteErr } = await sbAdmin
      .from("athletes")
      .select("email")
      .eq("org_id", profileOrgId)
      .eq("user_id", profileUserId)
      .maybeSingle();

    if (athleteErr) {
      return serverError(`Failed to load athlete: ${athleteErr.message}`, origin);
    }

    const { data: guardianRow, error: guardianErr } = await sbAdmin
      .from("guardian_contacts")
      .select("email")
      .eq("org_id", profileOrgId)
      .eq("user_id", profileUserId)
      .maybeSingle();

    if (guardianErr) {
      return serverError(`Failed to load guardian: ${guardianErr.message}`, origin);
    }

    const athleteEmail = athleteRow?.email?.trim().toLowerCase() ?? "";
    const guardianEmail = guardianRow?.email?.trim().toLowerCase() ?? "";
    if (athleteEmail && guardianEmail && athleteEmail === guardianEmail) {
      effectiveRole = "parent";
    }
  }

  let coach_id: string | null = null;
  let athlete_id: string | null = null;

  if (effectiveRole === "coach" && profileUserId) {
    const { data: coachRow, error: coachErr } = await sbAdmin
      .from("coaches")
      .select("id")
      .eq("user_id", profileUserId)
      .maybeSingle();

    if (coachErr) {
      return serverError(`Failed to load coach: ${coachErr.message}`, origin);
    }

    coach_id = coachRow?.id ?? null;
  } else if (effectiveRole === "athlete" && profileUserId) {
    const { data: athleteRow, error: athleteErr } = await sbAdmin
      .from("athletes")
      .select("id")
      .eq("user_id", profileUserId)
      .maybeSingle();

    if (athleteErr) {
      return serverError(`Failed to load athlete: ${athleteErr.message}`, origin);
    }

    athlete_id = athleteRow?.id ?? null;
  }

  return json(
    {
      ok: true,
      user: {
        id: profile.id,
        full_name: profile.full_name ?? null,
        email: profile.email,
        role: effectiveRole,
        default_org_id: profile.default_org_id ?? null,
        coach_id,
        athlete_id,
      },
    },
    origin,
  );
}

function readStringField(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

export async function handleTestWelcomeEmail(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: { user?: { email: string | null } },
) {
  if (req.method !== "POST") return badRequest("Use POST", origin);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid JSON body", origin);
  }

  const body = payload as Record<string, unknown>;
  const emailFromBody = readStringField(body, "email");
  const emailFromCtx = ctx?.user?.email?.trim() ?? "";
  const email = emailFromBody || emailFromCtx;
  if (!email) {
    return badRequest("email is required", origin);
  }

  const fullName = readStringField(body, "fullName", "full_name") || null;
  const actionLinkOverride = readStringField(body, "actionLink", "action_link");
  const redirectTo = readStringField(body, "redirectTo", "redirect_to");
  const from = readStringField(body, "from") || undefined;
  const subject = readStringField(body, "subject") || undefined;

  const linkTypeRaw = readStringField(body, "linkType", "link_type");
  const linkType = linkTypeRaw ? linkTypeRaw.toLowerCase() : "magiclink";
  if (linkType !== "magiclink" && linkType !== "invite") {
    return badRequest("link_type must be 'magiclink' or 'invite'", origin);
  }

  try {
    let actionLink = actionLinkOverride;
    if (!actionLink) {
      const dataValue = body.data;
      const data =
        dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)
          ? (dataValue as Record<string, unknown>)
          : undefined;

      if (linkType === "invite") {
        const generated = await generateInviteLink(email, {
          redirectTo: redirectTo || undefined,
          data,
        });
        actionLink = generated.actionLink;
      } else {
        const generated = await generateMagicLink(email, {
          redirectTo: redirectTo || undefined,
          data,
        });
        actionLink = generated.actionLink;
      }
    }

    await sendWelcomeEmail(email, fullName, actionLink, { from, subject });
    return json({ ok: true, email, action_link: actionLink }, origin);
  } catch (err) {
    console.error("[handleTestWelcomeEmail] failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return serverError(`Failed to send welcome email: ${message}`, origin);
  }
}

export async function handleTestBulkEvaluationReportEmails(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  _ctx?: { user?: { email: string | null } },
) {
  if (req.method !== "POST") return badRequest("Use POST", origin);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return badRequest("Invalid JSON body", origin);
  }

  const body = payload as Record<string, unknown>;
  const itemsRaw = body.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return badRequest("items must be a non-empty array", origin);
  }

  for (const [index, item] of itemsRaw.entries()) {
    if (!item || typeof item !== "object") {
      return badRequest(`items[${index}] must be an object`, origin);
    }
  }

  const subject = readStringField(body, "subject") || undefined;
  const appName = readStringField(body, "appName") || undefined;

  try {
    const result = await sendBulkEvaluationReportEmails(itemsRaw as EvaluationReportEmailInput[], {
      subject,
      appName,
    });
    return json({ ok: true, result }, origin);
  } catch (err) {
    console.error("[handleTestBulkEvaluationReportEmails] failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return serverError(`Failed to send evaluation report emails: ${message}`, origin);
  }
}
