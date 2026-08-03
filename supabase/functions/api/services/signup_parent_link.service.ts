import { INVITE_REDIRECT_URL } from "../config/env.ts";
import { errorResult, SUPABASE_CLIENT_NOT_INITIALIZED, supabaseClientNotInitializedError } from "../utils/errors.ts";
import { generateInviteLink, sendWelcomeEmail } from "./email.service.ts";
import { sbAdmin } from "./supabase.ts";

export type ParentProfileForLink = {
  id: string;
  user_id: string | null;
  email: string | null;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
};

export type ResolveParentEmailResult =
  | { status: "none" }
  | { status: "parent"; profile: ParentProfileForLink }
  | { status: "non_parent"; role: string | null }
  | { status: "error"; error: unknown };

export type LinkParentResult = { ok: true; guardian_id: string } | { ok: false; error: string };

export type InviteParentResult =
  | {
      ok: true;
      guardian_id: string;
      parent_user_id: string;
      parent_linked: true;
      parent_invited: true;
      invite_email_sent: boolean;
      parent_link_error: string | null;
    }
  | {
      ok: false;
      parent_linked: false;
      parent_invited: false;
      invite_email_sent: false;
      parent_link_error: string;
    };

function resolveError(error: unknown): ResolveParentEmailResult {
  return { status: "error", error };
}

function buildParentFullName(profile: ParentProfileForLink): string | null {
  const fromParts = [profile.first_name, profile.last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  const full = profile.full_name?.trim() ?? "";
  return full || null;
}

function parentUserId(profile: ParentProfileForLink): string | null {
  const fromUserId = profile.user_id?.trim() ?? "";
  if (fromUserId) return fromUserId;
  const fromId = profile.id?.trim() ?? "";
  return fromId || null;
}

export function resolveActivateRedirectUrl(): string {
  const base = (INVITE_REDIRECT_URL ?? "").trim().replace(/\/+$/g, "");
  if (!base) return "";
  if (base.endsWith("/activate")) return base;
  return `${base}/activate`;
}

/**
 * Slice 2 lookup: profile by email.
 * - no row → none (Slice 3 will create)
 * - role parent → linkable
 * - any other role → fail signup
 */
export async function resolveParentEmailForSignup(parentEmail: string): Promise<ResolveParentEmailResult> {
  const client = sbAdmin;
  if (!client) {
    return resolveError(supabaseClientNotInitializedError());
  }

  const email = parentEmail.trim().toLowerCase();
  if (!email) return { status: "none" };

  const { data, error } = await client
    .from("profiles")
    .select("id, user_id, email, role, full_name, phone, first_name, last_name")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (error) return resolveError(error);
  if (!data?.id) return { status: "none" };

  const profile = data as ParentProfileForLink;
  if (profile.role === "parent") {
    return { status: "parent", profile };
  }

  return { status: "non_parent", role: profile.role ?? null };
}

async function ensureParentMembershipAndGuardianLink(args: {
  orgId: string;
  athleteId: string;
  userId: string;
  parentEmail: string;
  fullName: string | null;
  phone: string | null;
}): Promise<LinkParentResult> {
  const client = sbAdmin;
  if (!client) {
    return errorResult(SUPABASE_CLIENT_NOT_INITIALIZED);
  }

  const email = args.parentEmail.trim().toLowerCase();

  const { error: membershipError } = await client.from("org_memberships").upsert(
    {
      org_id: args.orgId,
      user_id: args.userId,
      role: "parent",
      is_active: true,
    },
    { onConflict: "org_id,user_id" },
  );

  if (membershipError) {
    return errorResult(membershipError.message);
  }

  const { data: existingGuardian, error: guardianLookupError } = await client
    .from("guardian_contacts")
    .select("id, user_id")
    .eq("org_id", args.orgId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (guardianLookupError) {
    return errorResult(guardianLookupError.message);
  }

  let guardianId: string | null = existingGuardian?.id ?? null;

  if (!guardianId) {
    const { data: createdGuardian, error: createGuardianError } = await client
      .from("guardian_contacts")
      .insert({
        org_id: args.orgId,
        user_id: args.userId,
        full_name: args.fullName,
        email,
        phone: args.phone,
      })
      .select("id")
      .single();

    if (createGuardianError) {
      return errorResult(createGuardianError.message);
    }
    guardianId = createdGuardian?.id ?? null;
  } else if (!existingGuardian?.user_id) {
    const { error: attachUserError } = await client
      .from("guardian_contacts")
      .update({ user_id: args.userId })
      .eq("id", guardianId)
      .eq("org_id", args.orgId);

    if (attachUserError) {
      return errorResult(attachUserError.message);
    }
  }

  if (!guardianId) {
    return errorResult("Failed to resolve guardian contact");
  }

  const { error: linkError } = await client.from("athlete_guardians").upsert(
    {
      athlete_id: args.athleteId,
      guardian_id: guardianId,
      relationship: null,
    },
    { onConflict: "athlete_id,guardian_id" },
  );

  if (linkError) {
    return errorResult(linkError.message);
  }

  return { ok: true, guardian_id: guardianId };
}

export async function linkExistingParentToAthlete(args: {
  orgId: string;
  athleteId: string;
  profile: ParentProfileForLink;
  parentEmail: string;
}): Promise<LinkParentResult> {
  const userId = parentUserId(args.profile);
  if (!userId) {
    return errorResult("Parent profile is missing user id");
  }

  return await ensureParentMembershipAndGuardianLink({
    orgId: args.orgId,
    athleteId: args.athleteId,
    userId,
    parentEmail: args.parentEmail,
    fullName: buildParentFullName(args.profile),
    phone: args.profile.phone?.trim() || null,
  });
}

export async function createAndInviteParentForAthlete(args: {
  orgId: string;
  athleteId: string;
  parentEmail: string;
}): Promise<InviteParentResult> {
  const client = sbAdmin;
  if (!client) {
    return {
      ok: false,
      parent_linked: false,
      parent_invited: false,
      invite_email_sent: false,
      parent_link_error: SUPABASE_CLIENT_NOT_INITIALIZED,
    };
  }

  const email = args.parentEmail.trim().toLowerCase();
  let parentUserId: string | null = null;

  try {
    const { data: created, error: createErr } = await client.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        activation: "parent_invite",
        org_id: args.orgId,
        athlete_id: args.athleteId,
      },
      app_metadata: { role: "parent" },
    });

    if (createErr) {
      return {
        ok: false,
        parent_linked: false,
        parent_invited: false,
        invite_email_sent: false,
        parent_link_error: createErr.message,
      };
    }

    parentUserId = created.user?.id ?? null;
    if (!parentUserId) {
      return {
        ok: false,
        parent_linked: false,
        parent_invited: false,
        invite_email_sent: false,
        parent_link_error: "Parent user was not returned by Supabase",
      };
    }

    const { error: profileError } = await client.from("profiles").upsert(
      {
        id: parentUserId,
        user_id: parentUserId,
        email,
        role: "parent",
        default_org_id: args.orgId,
        first_name: null,
        last_name: null,
        full_name: null,
        phone: null,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      throw new Error(profileError.message);
    }

    const linkResult = await ensureParentMembershipAndGuardianLink({
      orgId: args.orgId,
      athleteId: args.athleteId,
      userId: parentUserId,
      parentEmail: email,
      fullName: null,
      phone: null,
    });

    if (!linkResult.ok) {
      throw new Error(linkResult.error);
    }

    let invite_email_sent = false;
    let parent_link_error: string | null = null;

    try {
      const redirectTo = resolveActivateRedirectUrl() || undefined;
      const { actionLink } = await generateInviteLink(email, {
        redirectTo,
        data: {
          activation: "parent_invite",
          role: "parent",
          org_id: args.orgId,
          athlete_id: args.athleteId,
          user_id: parentUserId,
        },
      });
      const emailResult = await sendWelcomeEmail(email, null, actionLink);
      invite_email_sent = emailResult.ok;
      if (!emailResult.ok) {
        parent_link_error = `Invite email failed: ${emailResult.error}`;
      }
    } catch (emailErr) {
      const message = emailErr instanceof Error ? emailErr.message : String(emailErr);
      parent_link_error = `Invite email failed: ${message}`;
      console.error("[createAndInviteParentForAthlete] invite email failed", emailErr);
    }

    return {
      ok: true,
      guardian_id: linkResult.guardian_id,
      parent_user_id: parentUserId,
      parent_linked: true,
      parent_invited: true,
      invite_email_sent,
      parent_link_error,
    };
  } catch (err) {
    if (parentUserId) {
      await client.auth.admin.deleteUser(parentUserId).catch(() => {});
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      parent_linked: false,
      parent_invited: false,
      invite_email_sent: false,
      parent_link_error: message,
    };
  }
}

export async function activateParentProfile(args: {
  userId: string;
  firstName: string;
  lastName: string;
  cellNumber: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = sbAdmin;
  if (!client) {
    return errorResult(SUPABASE_CLIENT_NOT_INITIALIZED);
  }

  const firstName = args.firstName.trim();
  const lastName = args.lastName.trim();
  const phone = args.cellNumber.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  const { data: profile, error: profileLookupError } = await client
    .from("profiles")
    .select("id, role, default_org_id")
    .eq("id", args.userId)
    .maybeSingle();

  if (profileLookupError) {
    return errorResult(profileLookupError.message);
  }
  if (!profile?.id) {
    return errorResult("Parent profile not found");
  }
  if (profile.role !== "parent") {
    return errorResult("Only parent accounts can be activated here");
  }

  const { error: profileUpdateError } = await client
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone,
    })
    .eq("id", args.userId);

  if (profileUpdateError) {
    return errorResult(profileUpdateError.message);
  }

  const { error: guardianUpdateError } = await client
    .from("guardian_contacts")
    .update({
      full_name: fullName,
      phone,
    })
    .eq("user_id", args.userId);

  if (guardianUpdateError) {
    return errorResult(guardianUpdateError.message);
  }

  const { data: authUser, error: authLookupError } = await client.auth.admin.getUserById(args.userId);
  if (authLookupError) {
    return errorResult(authLookupError.message);
  }

  const existingMeta =
    authUser?.user?.user_metadata && typeof authUser.user.user_metadata === "object"
      ? { ...authUser.user.user_metadata }
      : {};
  delete existingMeta.activation;

  const { error: metaError } = await client.auth.admin.updateUserById(args.userId, {
    user_metadata: {
      ...existingMeta,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      cell_number: phone,
      activation_completed: true,
    },
  });

  if (metaError) {
    return errorResult(metaError.message);
  }

  return { ok: true };
}
