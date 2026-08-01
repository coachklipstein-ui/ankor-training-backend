import { sbAdmin } from "./supabase.ts";
import type {
  CreatePlanInput,
  InvitedPlanDto,
  InvitedPlanListInput,
  InvitePlanMembersInput,
  PlanDto,
  PlanDetailDto,
  PlanItemDto,
  PlanListFilterInput,
  PlanItemInput,
  UpdatePlanInput,
} from "../dtos/plans.dto.ts";

const PLAN_SELECT =
  "id, org_id, owner_user_id, name, description, visibility, status, tags, estimated_minutes, created_at, updated_at";
const PLAN_ITEM_SELECT =
  "id, plan_id, section_title, section_order, position, item_type, drill_id, title, instructions, sets, reps, duration_min, duration_seconds, rest_seconds, config, drill:drills!inner(name)";
const PLAN_WITH_ITEMS_SELECT = `${PLAN_SELECT}, practice_plan_items!inner(${PLAN_ITEM_SELECT})`;

function mapPlanRow(row: any): PlanDto {
  return {
    id: row.id,
    org_id: row.org_id ?? null,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description ?? null,
    visibility: row.visibility ?? "private",
    status: row.status ?? "draft",
    tags: Array.isArray(row.tags) ? row.tags : [],
    estimated_minutes: row.estimated_minutes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPlanItemRow(row: any): PlanItemDto {
  const drill = row.drill ?? null;

  return {
    id: row.id,
    plan_id: row.plan_id,
    section_title: row.section_title ?? null,
    section_order: row.section_order ?? null,
    position: row.position ?? null,
    item_type: row.item_type ?? "drill",
    drill_id: row.drill_id ?? null,
    drill_name: drill?.name ?? null,
    title: row.title ?? null,
    instructions: row.instructions ?? null,
    sets: row.sets ?? null,
    reps: row.reps ?? null,
    duration_min: row.duration_min ?? null,
    duration_seconds: row.duration_seconds ?? null,
    rest_seconds: row.rest_seconds ?? null,
    config: row.config ?? {},
  };
}

function buildPlanItemRows(plan_id: string, items: PlanItemInput[], startIndex = 0): Array<Record<string, unknown>> {
  return items.map((item, index) => ({
    plan_id,
    section_title: item.section_title ?? null,
    section_order: item.section_order ?? null,
    position: item.position ?? startIndex + index,
    item_type: item.item_type ?? "drill",
    drill_id: item.drill_id ?? null,
    title: item.title ?? null,
    instructions: item.instructions ?? null,
    sets: item.sets ?? null,
    reps: item.reps ?? null,
    duration_min: item.duration_min ?? null,
    duration_seconds: item.duration_seconds ?? null,
    rest_seconds: item.rest_seconds ?? null,
    config: item.config ?? {},
  }));
}

export async function listPlansByType(
  filters: PlanListFilterInput,
): Promise<{ data: PlanDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { type, user_id, org_id, limit, offset } = filters;
  const rangeTo = offset + (limit - 1);

  console.log("user_id:", user_id, "type:", type);

  let query = client
    .from("practice_plans")
    .select(PLAN_SELECT, { count: "exact" })
    .range(offset, rangeTo)
    .order("updated_at", { ascending: false });

  query = query.eq("type", type);
  query = query.eq("org_id", org_id);
  if (type !== "prebuild") {
    query = query.eq("owner_user_id", user_id);
  }
  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error };

  const items = (data ?? []).map((row: any) => mapPlanRow(row));
  return { data: items, count: count ?? items.length, error: null };
}

export async function listInvitedPlans(
  filters: InvitedPlanListInput,
): Promise<{ data: InvitedPlanDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { user_id, org_id, limit, offset } = filters;
  const rangeTo = offset + (limit - 1);

  const { data, error, count } = await client
    .from("practice_plans")
    .select(`${PLAN_SELECT}, practice_plan_members!inner(role, user_id, added_by, created_at)`, { count: "exact" })
    .eq("org_id", org_id)
    .eq("practice_plan_members.user_id", user_id)
    .neq("owner_user_id", user_id)
    .range(offset, rangeTo)
    .order("updated_at", { ascending: false });

  if (error) return { data: [], count: 0, error };

  const items = (data ?? []).map((row: any) => {
    const base = mapPlanRow(row);
    const member = Array.isArray(row.practice_plan_members) ? row.practice_plan_members[0] : row.practice_plan_members;

    return {
      ...base,
      member_role: member?.role ?? "viewer",
      invited_at: member?.created_at ?? base.created_at,
      invited_by: member?.added_by ?? null,
    };
  });

  return { data: items, count: count ?? items.length, error: null };
}

export async function invitePlanMembers(
  plan_id: string,
  org_id: string,
  input: InvitePlanMembersInput,
): Promise<{
  data: { invited_user_ids: string[]; skipped_user_ids: string[] } | null;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const userIds = Array.from(new Set(input.user_ids));
  const role = input.role ?? "viewer";

  const { data: planRow, error: planError } = await client
    .from("practice_plans")
    .select("id, org_id, owner_user_id")
    .eq("id", plan_id)
    .maybeSingle();

  if (planError) return { data: null, error: planError };
  if (!planRow) return { data: null, error: new Error("Plan not found") };
  if (!planRow.org_id) {
    return {
      data: null,
      error: new Error("Plan is not associated with an organization"),
    };
  }

  if (planRow.org_id !== org_id) {
    return {
      data: null,
      error: new Error("org_id does not match plan"),
    };
  }

  const orgId = planRow.org_id;

  const { data: athleteRows, error: athleteError } = await client
    .from("athletes")
    .select("user_id")
    .eq("org_id", orgId)
    .in("user_id", userIds);

  if (athleteError) return { data: null, error: athleteError };

  const { data: coachRows, error: coachError } = await client
    .from("coaches")
    .select("user_id")
    .eq("org_id", orgId)
    .in("user_id", userIds);

  if (coachError) return { data: null, error: coachError };

  const allowedSet = new Set(
    [...(athleteRows ?? []), ...(coachRows ?? [])].map((row: any) => row.user_id).filter(Boolean),
  );
  const invalidIds = userIds.filter((id) => !allowedSet.has(id));
  if (invalidIds.length > 0) {
    return {
      data: null,
      error: new Error(`Users not in organization: ${invalidIds.join(", ")}`),
    };
  }

  const { data: existingRows, error: existingError } = await client
    .from("practice_plan_members")
    .select("user_id")
    .eq("plan_id", plan_id)
    .in("user_id", userIds);

  if (existingError) return { data: null, error: existingError };

  const existingSet = new Set((existingRows ?? []).map((row: any) => row.user_id).filter(Boolean));
  const toInvite = userIds.filter((id) => !existingSet.has(id));
  const skipped = userIds.filter((id) => existingSet.has(id));

  if (toInvite.length === 0) {
    return { data: { invited_user_ids: [], skipped_user_ids: skipped }, error: null };
  }

  const invitedBy = input.added_by ?? planRow.owner_user_id ?? null;
  if (!invitedBy) {
    return { data: null, error: new Error("invited_by is required") };
  }

  const authResults = await Promise.all(
    toInvite.map(async (user_id) => {
      const { data, error } = await client.auth.admin.getUserById(user_id);
      return { user_id, user: data?.user ?? null, error };
    }),
  );

  const authError = authResults.find((result) => result.error)?.error;
  if (authError) return { data: null, error: authError };

  const emailByUserId = new Map<string, string>();
  for (const result of authResults) {
    const email = result.user?.email;
    if (email) {
      emailByUserId.set(result.user_id, email);
    }
  }

  const missingEmails = toInvite.filter((id) => !emailByUserId.has(id));
  if (missingEmails.length > 0) {
    return {
      data: null,
      error: new Error(`Missing emails for users: ${missingEmails.join(", ")}`),
    };
  }

  const invitedEmails = toInvite.map((id) => emailByUserId.get(id)).filter(Boolean) as string[];

  const { data: pendingRows, error: pendingError } = await client
    .from("practice_plan_invitations")
    .select("invited_email")
    .eq("plan_id", plan_id)
    .eq("status", "pending")
    .in("invited_email", invitedEmails);

  if (pendingError) return { data: null, error: pendingError };

  const pendingEmailSet = new Set((pendingRows ?? []).map((row: any) => row.invited_email).filter(Boolean));

  const inviteRows = toInvite
    .map((user_id) => {
      const invited_email = emailByUserId.get(user_id);
      if (!invited_email || pendingEmailSet.has(invited_email)) return null;
      return {
        plan_id,
        invited_by: invitedBy,
        invited_email,
        invited_user_id: user_id,
        role,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  if (inviteRows.length > 0) {
    const { error: inviteError } = await client.from("practice_plan_invitations").insert(inviteRows);

    if (inviteError) return { data: null, error: inviteError };
  }

  const rows = toInvite.map((user_id) => ({
    plan_id,
    user_id,
    role,
    added_by: invitedBy,
  }));

  const { error: insertError } = await client.from("practice_plan_members").insert(rows);

  if (insertError) return { data: null, error: insertError };

  return {
    data: { invited_user_ids: toInvite, skipped_user_ids: skipped },
    error: null,
  };
}

export async function getPlanById(
  plan_id: string,
  org_id: string,
): Promise<{ data: PlanDetailDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("practice_plans")
    .select(PLAN_WITH_ITEMS_SELECT)
    .eq("id", plan_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) return { data: null, error };

  if (!data) return { data: null, error: null };

  const items = Array.isArray(data.practice_plan_items)
    ? data.practice_plan_items.map((item: any) => mapPlanItemRow(item))
    : [];

  return {
    data: {
      ...mapPlanRow(data),
      practice_plan_items: items,
    },
    error: null,
  };
}

export async function updatePlan(
  plan_id: string,
  org_id: string,
  input: UpdatePlanInput,
): Promise<{ data: PlanDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { add_items = [], remove_item_ids = [], ...rest } = input;
  const patch: Record<string, unknown> = {};

  if (rest.name !== undefined) patch.name = rest.name.trim();
  if (rest.description !== undefined) patch.description = rest.description ?? null;
  if (rest.visibility !== undefined) patch.visibility = rest.visibility;
  if (rest.status !== undefined) patch.status = rest.status;
  if (rest.tags !== undefined) patch.tags = rest.tags ?? [];
  if (rest.estimated_minutes !== undefined) {
    patch.estimated_minutes = rest.estimated_minutes ?? null;
  }
  if (rest.org_id !== undefined) patch.org_id = rest.org_id ?? null;

  let planRow: any | null = null;

  if (Object.keys(patch).length > 0) {
    const { data, error } = await client
      .from("practice_plans")
      .update(patch)
      .eq("id", plan_id)
      .eq("org_id", org_id)
      .select(PLAN_SELECT)
      .maybeSingle();

    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error("Plan not found") };
    planRow = data;
  } else {
    const { data, error } = await client
      .from("practice_plans")
      .select(PLAN_SELECT)
      .eq("id", plan_id)
      .eq("org_id", org_id)
      .maybeSingle();

    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error("Plan not found") };
    planRow = data;
  }

  if (remove_item_ids.length > 0) {
    const { error: removeError } = await client
      .from("practice_plan_items")
      .delete()
      .eq("plan_id", plan_id)
      .in("id", remove_item_ids);
    if (removeError) return { data: null, error: removeError };
  }

  if (add_items.length > 0) {
    let startIndex = 0;
    const needsPosition = add_items.some((item) => item.position === null || item.position === undefined);

    if (needsPosition) {
      const { data: lastRow, error: lastError } = await client
        .from("practice_plan_items")
        .select("position")
        .eq("plan_id", plan_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastError) return { data: null, error: lastError };
      const lastPosition = typeof lastRow?.position === "number" ? lastRow.position : -1;
      startIndex = lastPosition + 1;
    }

    const rows = buildPlanItemRows(plan_id, add_items, startIndex);
    const { error: addError } = await client.from("practice_plan_items").insert(rows);
    if (addError) return { data: null, error: addError };
  }

  return { data: planRow ? mapPlanRow(planRow) : null, error: null };
}

export async function createPlan(input: CreatePlanInput): Promise<{ data: PlanDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const payload: Record<string, unknown> = {
    owner_user_id: input.owner_user_id,
    org_id: input.org_id ?? null,
    type: input.type ?? "custom",
    name: input.name.trim(),
    description: input.description ?? null,
    tags: input.tags ?? [],
    estimated_minutes: input.estimated_minutes ?? null,
  };

  if (input.visibility !== undefined) payload.visibility = input.visibility;
  if (input.status !== undefined) payload.status = input.status;

  const { data, error } = await client.from("practice_plans").insert(payload).select(PLAN_SELECT).single();

  if (error) return { data: null, error };

  const plan = data ? mapPlanRow(data) : null;
  if (!plan) {
    return { data: null, error: new Error("Failed to create plan") };
  }

  const items = input.items ?? [];
  const rows = buildPlanItemRows(plan.id, items);

  if (rows.length === 0) {
    await client.from("practice_plans").delete().eq("id", plan.id);
    return { data: null, error: new Error("items is required") };
  }

  const { error: itemsError } = await client.from("practice_plan_items").insert(rows);

  if (itemsError) {
    await client.from("practice_plans").delete().eq("id", plan.id);
    return { data: null, error: itemsError };
  }

  return { data: plan, error: null };
}

export async function getPlanAccess(plan_id: string): Promise<{
  data: { org_id: string | null; owner_user_id: string } | null;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("practice_plans")
    .select("org_id, owner_user_id")
    .eq("id", plan_id)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  return {
    data: {
      org_id: data.org_id ?? null,
      owner_user_id: data.owner_user_id,
    },
    error: null,
  };
}

export async function isPlanMember(plan_id: string, user_id: string): Promise<{ data: boolean; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: false, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("practice_plan_members")
    .select("user_id")
    .eq("plan_id", plan_id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (error) return { data: false, error };

  return { data: Boolean(data?.user_id), error: null };
}
