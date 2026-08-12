import { sbAdmin } from "./supabase.ts";

export type EnsureAuthUserInput = {
  readonly email: string;
  readonly password?: string;
  readonly role: string;
  readonly user_metadata?: Readonly<Record<string, unknown>>;
  readonly email_confirm?: boolean;
};

export type EnsureAuthUserData = {
  readonly userId: string;
  readonly created: boolean;
};

type AuthUserRow = {
  readonly id?: string;
  readonly email?: string;
};

type AuthAdmin = {
  readonly getUserByEmail?: (
    email: string,
  ) => Promise<{ data: { user?: AuthUserRow | null } | null; error: unknown }>;
  readonly listUsers?: (args: {
    page: number;
    perPage: number;
  }) => Promise<{
    data: { users?: ReadonlyArray<AuthUserRow> } | ReadonlyArray<AuthUserRow> | null;
    error: unknown;
  }>;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
};

const isAlreadyRegisteredError = (error: unknown): boolean =>
  errorMessage(error).toLowerCase().includes("already registered");

export const findUserIdByEmail = async (
  email: string,
): Promise<{ userId: string | null; error: unknown }> => {
  const client = sbAdmin;
  if (!client) {
    return { userId: null, error: new Error("Supabase client not initialized") };
  }

  const admin = client.auth?.admin as AuthAdmin | undefined;
  if (!admin) {
    return { userId: null, error: new Error("Supabase admin client not available") };
  }

  const normalized = normalizeEmail(email);

  if (typeof admin.getUserByEmail === "function") {
    const { data, error } = await admin.getUserByEmail(normalized);
    if (error) return { userId: null, error };
    return { userId: data?.user?.id ?? null, error: null };
  }

  if (typeof admin.listUsers === "function") {
    const perPage = 200;
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await admin.listUsers({ page, perPage });
      if (error) return { userId: null, error };
      const users = Array.isArray((data as { users?: unknown } | null)?.users)
        ? ((data as { users: ReadonlyArray<AuthUserRow> }).users)
        : Array.isArray(data)
          ? data
          : [];
      const match = users.find(
        (user) => typeof user?.email === "string" && user.email.toLowerCase() === normalized,
      );
      if (typeof match?.id === "string" && match.id.length > 0) {
        return { userId: match.id, error: null };
      }
      if (users.length < perPage) break;
    }
    return { userId: null, error: null };
  }

  return { userId: null, error: new Error("Supabase admin user lookup not supported") };
};

export const ensureAuthUser = async (
  input: EnsureAuthUserInput,
): Promise<{ data: EnsureAuthUserData | null; error: unknown }> => {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const email = normalizeEmail(input.email);
  const { userId: existingUserId, error: lookupError } = await findUserIdByEmail(email);
  if (lookupError) {
    return { data: null, error: lookupError };
  }
  if (existingUserId) {
    return { data: { userId: existingUserId, created: false }, error: null };
  }

  const createPayload: {
    email: string;
    password?: string;
    user_metadata: Readonly<Record<string, unknown>>;
    app_metadata: { role: string };
    email_confirm: boolean;
  } = {
    email,
    user_metadata: input.user_metadata ?? {},
    app_metadata: { role: input.role },
    email_confirm: input.email_confirm ?? true,
  };
  if (input.password !== undefined) {
    createPayload.password = input.password;
  }

  const { data: created, error: createErr } = await client.auth.admin.createUser(createPayload);

  if (createErr) {
    if (isAlreadyRegisteredError(createErr)) {
      const { userId: racedUserId, error: raceLookupError } = await findUserIdByEmail(email);
      if (raceLookupError) return { data: null, error: raceLookupError };
      if (racedUserId) {
        return { data: { userId: racedUserId, created: false }, error: null };
      }
    }
    return { data: null, error: createErr };
  }

  const userId = created.user?.id ?? null;
  if (!userId) {
    return { data: null, error: new Error("User was not returned by Supabase") };
  }

  return { data: { userId, created: true }, error: null };
};

export const deleteAuthUserIfCreated = async (
  userId: string | null | undefined,
  created: boolean,
): Promise<void> => {
  if (!created || !userId) return;
  const client = sbAdmin;
  if (!client) return;
  await client.auth.admin.deleteUser(userId).catch(() => {});
};

/** Rejects when the email already belongs to an auth user with an org membership. */
export const assertEmailNotOrgMember = async (
  orgId: string,
  email: string,
): Promise<{ error: unknown }> => {
  const client = sbAdmin;
  if (!client) {
    return { error: new Error("Supabase client not initialized") };
  }

  const { userId, error: userLookupError } = await findUserIdByEmail(email);
  if (userLookupError) return { error: userLookupError };
  if (!userId) return { error: null };

  const { data: existingMembership, error: membershipLookupError } = await client
    .from("org_memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipLookupError) return { error: membershipLookupError };
  if (existingMembership?.user_id) {
    return { error: new Error("user already a member of this organization") };
  }

  return { error: null };
};
