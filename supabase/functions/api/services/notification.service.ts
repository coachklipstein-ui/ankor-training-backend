import { sbAdmin } from "./supabase.ts";
import { getEvaluationReportContext } from "./evaluations.service.ts";
import { getAthleteById } from "./athletes.service.ts";

export type NotificationType =
  | "evaluation_completed"
  | "athlete_joined"
  | "coach_joined"
  | "plan_shared"

export type NotificationRow = {
  id: string;
  org_id: string | null;
  user_id: string | null;
  type: string;
  evaluation_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

export type CreateNotificationInput = {
  org_id?: string | null;
  user_id?: string | null;
  type: NotificationType;
  evaluation_id?: string | null;
  payload?: Record<string, unknown> | null;
};

export type BulkCreateNotificationInput = CreateNotificationInput[];

export type ListNotificationsFilters = {
  org_id?: string | null;
  user_id?: string | null;
  type?: NotificationType | NotificationType[];
  unread_only?: boolean;
  limit?: number;
  offset?: number;
};

function mapRow(row: any): NotificationRow {
  return {
    id: row.id,
    org_id: row.org_id ?? null,
    user_id: row.user_id ?? null,
    type: row.type,
    evaluation_id: row.evaluation_id ?? null,
    payload: row.payload ?? null,
    created_at: row.created_at,
    read_at: row.read_at ?? null,
  };
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ data: NotificationRow | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("notifications")
    .insert({
      org_id: input.org_id ?? null,
      user_id: input.user_id ?? null,
      type: input.type,
      evaluation_id: input.evaluation_id ?? null,
      payload: input.payload ?? null,
    })
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  return { data: mapRow(data), error: null };
}

export async function createNotifications(
  inputs: BulkCreateNotificationInput,
): Promise<{ data: NotificationRow[]; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], error: new Error("Supabase client not initialized") };
  }

  if (!inputs.length) {
    return { data: [], error: null };
  }

  const rows = inputs.map((input) => ({
    org_id: input.org_id ?? null,
    user_id: input.user_id ?? null,
    type: input.type,
    evaluation_id: input.evaluation_id ?? null,
    payload: input.payload ?? null,
  }));

  const { data, error } = await client
    .from("notifications")
    .insert(rows)
    .select();

  if (error) {
    return { data: [], error };
  }

  return { data: (data ?? []).map(mapRow), error: null };
}

export async function getNotificationById(
  id: string,
): Promise<{ data: NotificationRow | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("notifications")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return { data: null, error };
  }

  return { data: mapRow(data), error: null };
}

export async function listNotifications(
  filters: ListNotificationsFilters = {},
): Promise<{ data: NotificationRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const {
    user_id,
    type,
    unread_only,
    limit = 50,
    offset = 0,
  } = filters;

  let query = client
    .from("notifications")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (user_id) {
    query = query.eq("user_id", user_id);
  }
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    query = query.in("type", types);
  }
  if (unread_only) {
    query = query.is("read_at", null);
  }

  const rangeTo = offset + (limit - 1);
  const { data, error, count } = await query.range(offset, rangeTo);

  if (error) {
    return { data: [], count: 0, error };
  }

  return {
    data: (data ?? []).map(mapRow),
    count: count ?? 0,
    error: null,
  };
}

export async function markNotificationAsRead(
  id: string,
): Promise<{ data: NotificationRow | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  return { data: mapRow(data), error: null };
}

export async function markAllNotificationsAsRead(
  filters: { user_id?: string | null },
): Promise<{ count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { count: 0, error: new Error("Supabase client not initialized") };
  }

  let query = client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (filters.user_id) {
    query = query.eq("user_id", filters.user_id);
  }

  const { count, error } = await query.select("id", { count: "exact", head: true });

  if (error) {
    return { count: 0, error };
  }

  return { count: count ?? 0, error: null };
}


export async function deleteNotification(
  id: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("notifications")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Notification not found") };
  }

  return { data: { id: data[0].id }, error: null };
}

export async function notifyEvaluationCompleted(
  evaluationId: string,
  org_id: string) {
 try {
    const [context, recipients] = await Promise.all([
      getEvaluationReportContext(evaluationId, org_id),
      listEvaluationNotificationRecipients(evaluationId),
    ]);

    if (recipients.length === 0) {
      return { data: [], error: null };
    }

    const items: EvaluationNotificationInput[] = recipients.map((recipient) => ({
      user_id: recipient.user_id,
      evaluation_id: evaluationId,
      org_id,
      title: `New evaluation available for ${recipient.full_name ?? recipient.full_name ?? "athlete"}`,
      description: `${context.coachName} submitted a new evaluation - ${context.evaluationTitle} - for ${recipient.full_name}, on ${context.evaluationDate}.`,
      topic: "evaluation_completed",
      link: context.evaluationLink,
    }));

      if (items.length > 0) {
        items.forEach(async (item) => {
          const notifResult = await notifyEvaluationCompletedInternal({
            org_id: item.org_id,
            user_id: item.user_id,
            evaluation_id: item.evaluation_id,
            payload: {
              title: item.title,
              description: item.description,
              topic: item.topic,
              link: item.link,
            },
          });

          if (notifResult.error) {
            console.error("[handleSubmitEvaluation] notification insert error", notifResult.error);
          }
        });
      }
  } catch (err) {
    return { data: [], error: err };
  }
}

async function notifyEvaluationCompletedInternal(params: {
  org_id: string;
  user_id: string;
  evaluation_id: string;
  payload?: Record<string, unknown>;
}) {
  return createNotification({
    org_id: params.org_id,
    user_id: params.user_id,
    type: "evaluation_completed",
    evaluation_id: params.evaluation_id,
    payload: params.payload ?? null,
  });
}

export async function notifyAthleteJoined(params: {
  org_id: string;
  user_id: string;
  payload?: Record<string, unknown>;
}) {
  return createNotification({
    org_id: params.org_id,
    user_id: params.user_id,
    type: "athlete_joined",
    payload: params.payload ?? null,
  });
}

export async function notifyCoachJoined(params: {
  org_id: string;
  user_id: string;
  teamName: string;
  coachName: string;
  coachId: string;
}) {
  return createNotification({
    org_id: params.org_id,
    user_id: params.user_id,
    type: "coach_joined",
    payload: {
      title: `New member joined ${params.teamName}`,
      description: `${params.coachName} joined ${params.teamName} using your Easy Join code`,
      topic: "coach_joined",
      link: `/admin/coaches/${params.coachId}`,
    },
  });
}

export async function notifyPlanShared(params: {
  org_id: string;
  user_id: string;
  plan_id: string;
  planName: string;
  hostName: string;
}) {
  return createNotification({
    org_id: params.org_id,
    user_id: params.user_id,
    type: "plan_shared",
    payload: {
      title: "You've been invited to a practice plan",
      description: `${params.hostName} shared the practice plan "${params.planName}" with you.".`,
      topic: "plan_shared",
      link: `/practice-plans/${params.plan_id}`,
    },
  });
}

export type EvaluationNotificationRecipient = {
  user_id: string;
  full_name: string | null;
};

async function listEvaluationNotificationRecipients(
  evaluationId: string,
): Promise<EvaluationNotificationRecipient[]> {
  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const { data, error } = await client
    .from("evaluation_items")
    .select(
      `
      athlete:athletes!inner (
        id,
        user_id,
        org_id,
        first_name,
        full_name
      )
    `,
    )
    .eq("evaluation_id", evaluationId);

  if (error) {
    throw error;
  }

  const recipients: EvaluationNotificationRecipient[] = [];
  const seenUserIds = new Set<string>();

  for (const row of data ?? []) {
    const athlete = (row as any)?.athlete;
    if (!athlete) continue;

    const userId = typeof athlete.user_id === "string" && athlete.user_id.trim()
      ? athlete.user_id.trim()
      : null;
    if (!userId || seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);

    const full_name = typeof athlete.full_name === "string" && athlete.full_name.trim()
      ? athlete.full_name.trim()
      : null;

    recipients.push({ user_id: userId, full_name: full_name });

    const athleteResult = await getAthleteById(athlete.id, athlete.org_id);

    if (!athleteResult.error && athleteResult.data && athleteResult.data.parent) {
      const parent = athleteResult.data.parent;
      if (parent.email && parent.full_name) {
        const { data: profileRow } = await client
          .from("profiles")
          .select("user_id, full_name")
          .eq("email", parent.email)
          .maybeSingle();

        if (profileRow) {
          recipients.push({ user_id: profileRow.user_id, full_name: profileRow.full_name });
        }
      }
    }
  }

  return recipients;
}

export type EvaluationNotificationInput = {
  user_id: string;
  evaluation_id: string;
  org_id: string;
  title: string;
  description: string;
  topic: string;
  link: string;
};

export async function buildEvaluationNotificationInputs(
  evaluationId: string,
  org_id: string,
): Promise<{ data: EvaluationNotificationInput[]; error: unknown | null }> {
  try {
    const [context, recipients] = await Promise.all([
      getEvaluationReportContext(evaluationId, org_id),
      listEvaluationNotificationRecipients(evaluationId),
    ]);

    if (recipients.length === 0) {
      return { data: [], error: null };
    }

    const items: EvaluationNotificationInput[] = recipients.map((recipient) => ({
      user_id: recipient.user_id,
      evaluation_id: evaluationId,
      org_id,
      title: `New evaluation available for ${recipient.first_name}`,
      description: `${context.coachName} submitted a new evaluation - ${context.evaluationTitle} - for ${recipient.first_name}, on ${context.evaluationDate}.`,
      topic: "evaluation_completed",
      link: context.evaluationLink,
    }));

    return { data: items, error: null };
  } catch (err) {
    return { data: [], error: err };
  }
}
