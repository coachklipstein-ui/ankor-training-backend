import { sbAdmin } from "./supabase.ts";
import { EvaluationInput, EvaluationWithItems } from "../schemas/evaluations.ts";
import { EvaluationDetailDto, type EvaluationMatrixUpdateDto, toEvaluationDetailDto } from "../dtos/evaluations.dto.ts";
import { INVITE_REDIRECT_URL } from "../config/env.ts";
import type { EvaluationReportEmailInput } from "./email.service.ts";

type SubmitEvaluationResult = { ok: true; data: { id: string; status: string } } | { ok: false; error: unknown };

export type LatestEvaluationRow = {
  evaluation_id: string;
  created_at: string | null;
  scorecard_name: string | null;
  coach_name: string | null;
  athlete_id: string;
  athlete_full_name: string | null;
};

export type LatestEvaluationsFilters = {
  org_id: string;
  athlete_id?: string;
  athlete_name?: string;
  user_id?: string;
  limit: number;
  offset: number;
  scorecard_name?: string;
  coach_name?: string;
  coach_id?: string;
  date_from?: string;
  date_to?: string;
};

export type EvaluationAthleteRow = {
  evaluation_id: string;
  created_at: string | null;
  scorecard_name: string | null;
  coach_name: string | null;
  athlete_id: string;
  athlete_full_name: string | null;
  athletes_name: string | null;
};

export type EvaluationAthletesByIdFilters = {
  org_id: string;
  evaluation_id: string;
  athlete_id?: string;
  limit: number;
  offset: number;
};

export type EvaluationImprovementSkillRow = {
  evaluation_id: string;
  skill_id: string;
  skill_name: string | null;
  rating: number | null;
};

export type EvaluationImprovementSkillFilters = {
  org_id: string;
  evaluation_id: string;
  athlete_id: string;
  limit: number;
  offset: number;
  rating_max: number;
};

export type EvaluationSkillVideoRow = {
  evaluation_id: string;
  skill_id: string;
  title: string | null;
  object_path: string | null;
  url: string | null;
  rating: number | null;
};

export type EvaluationSkillVideoFilters = {
  org_id: string;
  evaluation_id: string;
  athlete_id: string;
  rating_max: number;
};

export type EvaluationSubskillRatingRow = {
  evaluation_id: string;
  skill_id: string;
  skill_descrip: string | null;
  category_id: string;
  category_descrip: string | null;
  rating: number | null;
};

export type EvaluationSubskillRatingFilters = {
  org_id: string;
  evaluation_id: string;
  athlete_id: string;
  rating_max: number;
};

export type EvaluationWorkoutProgressRow = {
  id: string;
  org_id: string;
  evaluation_id: string;
  athlete_id: string;
  progress: number | null;
  level: number | null;
  maxWorkoutReps: number | null;
};

export type EvaluationWorkoutProgressFilters = {
  org_id: string;
  athlete_id: string;
  evaluation_id?: string;
  limit?: number;
  offset?: number;
};

export type EvaluationWorkoutProgressUpdateInput = {
  org_id: string;
  athlete_id: string;
  evaluation_id: string;
};

export type EvaluationWorkoutSummaryFilters = {
  org_id: string;
  athlete_id: string;
  user_id: string;
};

export type EvaluationWorkoutSummary = {
  total_evals: number;
  total_reps: number;
  total_plans_shares: number;
};

function storageObjectPathFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const prefix = "/storage/v1/object/";
  if (!url.pathname.startsWith(prefix)) return null;

  const parts = url.pathname.slice(prefix.length).split("/").filter(Boolean);
  const offset = parts[0] === "public" || parts[0] === "sign" ? 1 : 0;
  if (parts.length - offset < 2) return null;

  return parts.slice(offset + 1).join("/");
}

export type EvaluationWorkoutDrillsFilters = {
  org_id: string;
  athlete_id: string;
  evaluation_id: string;
};

export type LatestEvaluationWorkoutDrillsFilters = {
  org_id: string;
  athlete_id: string;
};

export type EvaluationWorkoutDrillVideo = {
  id: string;
  title: string;
  duration: string;
  thumbnailUrl: string | null;
};

export type EvaluationWorkoutDrillLevel = {
  level: number;
  title: string;
  targetReps: number | null;
  drills: EvaluationWorkoutDrillVideo[];
};

export async function rpcBulkCreateEvaluations(args: {
  evaluations: EvaluationInput[];
}): Promise<{ data: EvaluationWithItems[] | null; error: unknown }> {
  const { data, error } = await sbAdmin!.rpc("evaluations_bulk_create_tx", args);

  if (error) {
    return { data: null, error };
  }

  const mapped: EvaluationWithItems[] | null =
    (data as any[] | null)?.map((row: any) => {
      const {
        template_id,
        teams_id,
        evaluation_items,
        // keep everything else (id, org_id, coach_id, notes, created_at, sport_id, etc.)
        ...rest
      } = row;

      const mappedItems =
        (evaluation_items as any[] | undefined)?.map((item: any) => {
          const { subskill_id, comment, ...itemRest } = item;
          return {
            ...itemRest,
            // DB → TS schema mapping
            skill_id: subskill_id,
            comments: comment,
          };
        }) ?? [];

      return {
        ...rest,
        // DB → TS schema mapping
        scorecard_template_id: template_id,
        team_id: teams_id,
        evaluation_items: mappedItems,
      } as EvaluationWithItems;
    }) ?? null;

  return {
    data: mapped,
    error: null,
  };
}

export async function listEvaluations(org_id?: string): Promise<{
  data: any[] | null;
  error: unknown;
}> {
  let query = sbAdmin!
    .from("evaluations")
    .select(
      `
      id,
      org_id,
      template_id,
      teams_id,
      coach_id,
      notes,
      created_at,
      status
      team:teams!inner (
        id,
        name
      ),
      template:scorecard_templates!inner (
        id,
        name
      )
    `,
    )
    .neq("status", "completed")
    .order("created_at", { ascending: false });

  if (org_id) {
    query = query.eq("org_id", org_id);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error };
  }

  const mapped = (data ?? []).map((row: any) => {
    const { template_id, team, template, ...rest } = row;

    // ---- team name ----
    const team_name: string | null = team?.name ?? null;

    // ---- template name ----
    const scorecard_template_name: string | null = template?.name ?? null;

    return {
      ...rest,
      scorecard_template_id: template_id,
      scorecard_template_name,
      team_name,
    };
  });

  return { data: mapped, error: null };
}

export async function listLatestEvaluationsByAthlete(
  filters: LatestEvaluationsFilters,
): Promise<{ data: LatestEvaluationRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const {
    org_id,
    athlete_id,
    athlete_name,
    user_id,
    limit,
    offset,
    scorecard_name,
    coach_name,
    coach_id,
    date_from,
    date_to,
  } = filters;

  let query = client
    .from("evaluation_items")
    .select(
      `
      evaluation_id,
      evaluation:evaluations!inner (
        id,
        org_id,
        created_at,
        coach:coaches!inner (
          id,
          full_name
        ),
        scorecard_template:scorecard_templates!inner (
          id,
          name
        )
      ),
      athlete:athletes!inner (
        id,
        full_name
      )
    `,
    )
    .eq("evaluations.org_id", org_id);

  if (user_id) {
    const { data: guardianRow, error: guardianError } = await client
      .from("guardian_contacts")
      .select("id")
      .eq("org_id", org_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (guardianError) {
      return { data: [], count: 0, error: guardianError };
    }

    const guardianId = guardianRow?.id ?? null;
    if (!guardianId) {
      return { data: [], count: 0, error: null };
    }

    const { data: guardianLinks, error: guardianLinksError } = await client
      .from("athlete_guardians")
      .select("athlete_id")
      .eq("guardian_id", guardianId);

    if (guardianLinksError) {
      return { data: [], count: 0, error: guardianLinksError };
    }

    const athleteIds = Array.from(
      new Set(
        (guardianLinks ?? [])
          .map((row: any) => row?.athlete_id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    if (athleteIds.length === 0) {
      return { data: [], count: 0, error: null };
    }

    if (athlete_id && !athleteIds.includes(athlete_id)) {
      return { data: [], count: 0, error: null };
    }

    query = query.in("athlete_id", athleteIds);
  }

  if (athlete_id) {
    query = query.eq("athlete_id", athlete_id);
  }
  if (athlete_name) {
    query = query.ilike("athletes.full_name", `%${athlete_name}%`);
  }
  if (coach_id) {
    query = query.eq("evaluations.coach_id", coach_id);
  }
  if (coach_name) {
    query = query.ilike("coaches.full_name", `%${coach_name}%`);
  }
  if (date_from) {
    query = query.gte("evaluations.created_at", date_from);
  }
  if (date_to) {
    query = query.lte("evaluations.created_at", date_to);
  }

  const { data, error } = await query;
  if (error) {
    return { data: [], count: 0, error };
  }

  const scorecardQuery = scorecard_name ? scorecard_name.toLowerCase() : null;
  const grouped = new Map<string, LatestEvaluationRow>();

  for (const row of data ?? []) {
    const evaluation = row?.evaluation ?? null;
    if (!evaluation) continue;
    if (evaluation.org_id && evaluation.org_id !== org_id) continue;
    if (scorecardQuery) {
      const templateName = evaluation.scorecard_template?.name ?? "";
      if (!templateName.toLowerCase().includes(scorecardQuery)) {
        continue;
      }
    }

    const athlete = row?.athlete ?? null;
    const athleteId = athlete?.id ?? athlete_id;
    const evaluationId = row?.evaluation_id ?? evaluation?.id;
    if (!evaluationId || !athleteId) continue;

    const key = `${evaluationId}:${athleteId}`;
    if (grouped.has(key)) continue;

    grouped.set(key, {
      evaluation_id: evaluationId,
      created_at: evaluation.created_at ?? null,
      scorecard_name: evaluation.scorecard_template?.name ?? null,
      coach_name: evaluation.coach?.full_name ?? null,
      athlete_id: athleteId,
      athlete_full_name: athlete?.full_name ?? null,
    });
  }

  const allItems = Array.from(grouped.values());
  allItems.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return bTime - aTime;
  });

  const paged = allItems.slice(offset, offset + limit);

  return { data: paged, count: allItems.length, error: null };
}

export async function listEvaluationAthletesById(
  filters: EvaluationAthletesByIdFilters,
): Promise<{ data: EvaluationAthleteRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, evaluation_id, athlete_id, limit, offset } = filters;

  let query = client
    .from("evaluation_items")
    .select(
      `
      evaluation_id,
      evaluation:evaluation_id (
        id,
        org_id,
        created_at,
        coach:coach_id (
          id,
          full_name
        ),
        scorecard_template:template_id (
          id,
          name
        )
      ),
      athlete:athlete_id (
        id,
        full_name
      )
    `,
    )
    .eq("evaluation_id", evaluation_id);

  if (athlete_id) {
    query = query.eq("athlete_id", athlete_id);
  }

  const { data, error } = await query;

  if (error) {
    return { data: [], count: 0, error };
  }
  if (!data || data.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const scopedRows = (data ?? []).filter((row: any) => row?.evaluation?.org_id === org_id);
  if (scopedRows.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const athleteMap = new Map<string, { id: string; full_name: string | null }>();
  for (const row of scopedRows) {
    const athleteId = row?.athlete?.id;
    if (!athleteId) continue;
    if (!athleteMap.has(athleteId)) {
      athleteMap.set(athleteId, {
        id: athleteId,
        full_name: row?.athlete?.full_name ?? null,
      });
    }
  }

  const evaluation = scopedRows[0]?.evaluation ?? null;
  const allItems = Array.from(athleteMap.values()).map((athlete) => ({
    evaluation_id: evaluation?.id ?? evaluation_id,
    created_at: evaluation?.created_at ?? null,
    scorecard_name: evaluation?.scorecard_template?.name ?? null,
    coach_name: evaluation?.coach?.full_name ?? null,
    athlete_id: athlete.id,
    athlete_full_name: athlete.full_name ?? null,
    athletes_name: athlete.full_name ?? null,
  }));

  const paged = allItems.slice(offset, offset + limit);

  return { data: paged, count: allItems.length, error: null };
}

export async function listEvaluationImprovementSkills(
  filters: EvaluationImprovementSkillFilters,
): Promise<{ data: EvaluationImprovementSkillRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, evaluation_id, athlete_id, limit, offset, rating_max } = filters;

  const { data, error } = await client
    .from("evaluations")
    .select(
      `
      id,
      created_at,
      template:scorecard_templates!inner (
        id
      ),
      evaluation_items!inner (
        evaluation_id,
        athlete_id,
        subskill_id,
        rating
      )
    `,
    )
    .eq("id", evaluation_id)
    .eq("org_id", org_id)
    .eq("evaluation_items.athlete_id", athlete_id)
    .lt("evaluation_items.rating", rating_max)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], count: 0, error };
  }

  const rawItems: Array<{
    evaluation_id: string;
    subskill_id: string;
    rating: number | null;
    created_at: string | null;
  }> = [];

  for (const row of data ?? []) {
    const created_at = row?.created_at ?? null;
    const evaluationId = row?.id ?? evaluation_id;
    const items = Array.isArray(row?.evaluation_items)
      ? row.evaluation_items
      : row?.evaluation_items
        ? [row.evaluation_items]
        : [];

    for (const item of items) {
      const subskillId = item?.subskill_id;
      if (!subskillId) continue;
      rawItems.push({
        evaluation_id: item?.evaluation_id ?? evaluationId,
        subskill_id: subskillId,
        rating: item?.rating ?? null,
        created_at,
      });
    }
  }

  if (rawItems.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const skillIds = Array.from(new Set(rawItems.map((item) => item.subskill_id).filter(Boolean)));
  if (skillIds.length === 0) {
    return { data: [], count: 0, error: null };
  }

  // evaluation_items.subskill_id may contain either a scorecard_subskills.id
  // or an older direct skills.id value.
  const { data: subskills, error: subskillError } = await client
    .from("scorecard_subskills")
    .select("id, skill_id")
    .in("id", skillIds);

  if (subskillError) {
    return { data: [], count: 0, error: subskillError };
  }

  const skillIdByInputId = new Map<string, string>();
  for (const row of subskills ?? []) {
    const id = row?.id;
    const skillId = row?.skill_id;
    if (typeof id !== "string" || !id) continue;
    if (typeof skillId !== "string" || !skillId) continue;
    skillIdByInputId.set(id, skillId);
  }

  for (const skillId of skillIds) {
    if (!skillIdByInputId.has(skillId)) {
      skillIdByInputId.set(skillId, skillId);
    }
  }

  const resolvedSkillIds = Array.from(new Set(skillIdByInputId.values()));
  if (resolvedSkillIds.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const { data: skills, error: skillsError } = await client
    .from("skills")
    .select("id, title")
    .in("id", resolvedSkillIds);

  if (skillsError) {
    return { data: [], count: 0, error: skillsError };
  }

  const skillNameById = new Map<string, string | null>();
  for (const skill of skills ?? []) {
    const id = skill?.id;
    if (typeof id !== "string" || !id) continue;
    skillNameById.set(id, skill?.title ?? null);
  }

  const joined = rawItems
    .map((item) => ({
      ...item,
      resolved_skill_id: skillIdByInputId.get(item.subskill_id) ?? item.subskill_id,
    }))
    .filter((item) => skillNameById.has(item.resolved_skill_id))
    .map((item) => ({
      evaluation_id: item.evaluation_id,
      skill_id: item.resolved_skill_id,
      skill_name: skillNameById.get(item.resolved_skill_id) ?? null,
      rating: item.rating ?? null,
      created_at: item.created_at ?? null,
    }));

  joined.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return bTime - aTime;
  });

  const paged = joined.slice(offset, offset + limit);

  return {
    data: paged.map(({ created_at, ...rest }) => rest),
    count: joined.length,
    error: null,
  };
}

export async function listEvaluationSkillVideos(
  filters: EvaluationSkillVideoFilters,
): Promise<{ data: EvaluationSkillVideoRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, evaluation_id, athlete_id, rating_max } = filters;

  const { data, error } = await client.rpc("list_evaluation_skill_videos", {
    p_evaluation_id: evaluation_id,
    p_org_id: org_id,
    p_athlete_id: athlete_id,
    p_rating_max: rating_max,
  });

  if (error) {
    return { data: [], count: 0, error };
  }

  const results: Array<EvaluationSkillVideoRow & { created_at: string | null }> = [];
  for (const row of data ?? []) {
    const skillId = row?.skill_id;
    if (typeof skillId !== "string" || !skillId) continue;
    const url = typeof row?.url === "string" && row.url.trim() ? row.url.trim() : null;
    const rating = row?.rating === null || row?.rating === undefined ? null : Number(row.rating);

    results.push({
      evaluation_id: row?.evaluation_id ?? evaluation_id,
      skill_id: skillId,
      title: row?.title ?? null,
      object_path: storageObjectPathFromUrl(url),
      url,
      rating: Number.isFinite(rating) ? rating : null,
      created_at: row?.created_at ?? null,
    });
  }

  return {
    data: results.map(({ created_at, ...rest }) => rest),
    count: results.length,
    error: null,
  };
}

export async function listEvaluationSubskillRatings(
  filters: EvaluationSubskillRatingFilters,
): Promise<{ data: EvaluationSubskillRatingRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, evaluation_id, athlete_id } = filters;

  const { data, error } = await client
    .from("evaluations")
    .select(
      `
      id,
      created_at,
      org_id,
      evaluation_items!inner (
        evaluation_id,
        athlete_id,
        subskill_id,
        rating
      ),
      template:scorecard_templates!inner (
        id,
        scorecard_categories!inner (
          id,
          name,
          scorecard_subskills!inner (
            skill_id,
            name
          )
        )
      )
    `,
    )
    .eq("id", evaluation_id)
    .eq("org_id", org_id)
    .eq("evaluation_items.athlete_id", athlete_id)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], count: 0, error };
  }

  const skillInfoById = new Map<string, { skill_descrip: string | null; categoryIds: Set<string> }>();
  const categoryNameById = new Map<string, string | null>();

  for (const row of data ?? []) {
    const template = (row as any)?.template;
    const categories = Array.isArray(template?.scorecard_categories)
      ? template.scorecard_categories
      : template?.scorecard_categories
        ? [template.scorecard_categories]
        : [];

    for (const category of categories) {
      const categoryId = category?.id;
      if (typeof categoryId !== "string" || !categoryId) continue;
      if (!categoryNameById.has(categoryId)) {
        categoryNameById.set(categoryId, category?.name ?? null);
      }

      const subskills = Array.isArray(category?.scorecard_subskills)
        ? category.scorecard_subskills
        : category?.scorecard_subskills
          ? [category.scorecard_subskills]
          : [];

      for (const subskill of subskills) {
        const skillId = subskill?.skill_id;
        if (typeof skillId !== "string" || !skillId) continue;
        let skillInfo = skillInfoById.get(skillId);
        if (!skillInfo) {
          skillInfo = {
            skill_descrip: subskill?.name ?? null,
            categoryIds: new Set<string>(),
          };
          skillInfoById.set(skillId, skillInfo);
        } else if (!skillInfo.skill_descrip && subskill?.name) {
          skillInfo.skill_descrip = subskill.name ?? null;
        }
        skillInfo.categoryIds.add(categoryId);
      }
    }
  }

  if (skillInfoById.size === 0 || categoryNameById.size === 0) {
    return { data: [], count: 0, error: null };
  }

  const results: Array<EvaluationSubskillRatingRow & { created_at: string | null }> = [];
  for (const row of data ?? []) {
    const created_at = row?.created_at ?? null;
    const evaluationId = row?.id ?? evaluation_id;
    const items = Array.isArray(row?.evaluation_items)
      ? row.evaluation_items
      : row?.evaluation_items
        ? [row.evaluation_items]
        : [];

    for (const item of items) {
      const skillId = item?.subskill_id;
      if (!skillId) continue;
      const skillInfo = skillInfoById.get(skillId);
      if (!skillInfo) continue;

      for (const categoryId of skillInfo.categoryIds) {
        if (!categoryNameById.has(categoryId)) continue;
        results.push({
          evaluation_id: item?.evaluation_id ?? evaluationId,
          skill_id: skillId,
          skill_descrip: skillInfo.skill_descrip ?? null,
          category_id: categoryId,
          category_descrip: categoryNameById.get(categoryId) ?? null,
          rating: item?.rating ?? null,
          created_at,
        });
      }
    }
  }

  results.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return bTime - aTime;
  });

  return {
    data: results.map(({ created_at, ...rest }) => rest),
    count: results.length,
    error: null,
  };
}

export async function getEvaluationWorkoutSummary(
  filters: EvaluationWorkoutSummaryFilters,
): Promise<{ data: EvaluationWorkoutSummary | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { org_id, athlete_id, user_id } = filters;

  const evalsPromise = client
    .from("evaluation_items")
    .select(
      `
      evaluation_id,
      evaluation:evaluations!inner (
        org_id
      )
    `,
    )
    .eq("athlete_id", athlete_id)
    .eq("evaluations.org_id", org_id);

  const summaryPromise = client.rpc("get_workout_summary", {
    p_org_id: org_id,
    p_athlete_id: athlete_id,
    p_user_id: user_id,
  });

  const [{ data: evalRows, error: evalError }, { data: summaryRows, error: summaryError }] = await Promise.all([
    evalsPromise,
    summaryPromise,
  ]);

  if (evalError) {
    return { data: null, error: evalError };
  }
  if (summaryError) {
    return { data: null, error: summaryError };
  }

  const evalIds = new Set<string>();
  for (const row of evalRows ?? []) {
    const evalId = (row as any)?.evaluation_id;
    if (typeof evalId === "string" && evalId.trim()) {
      evalIds.add(evalId);
    }
  }

  const summaryRow = Array.isArray(summaryRows) ? (summaryRows[0] ?? null) : (summaryRows ?? null);
  const totalRepsRaw = (summaryRow as any)?.total_reps ?? 0;
  const totalPlansRaw = (summaryRow as any)?.total_plans_shares ?? 0;
  const total_reps = Number.isFinite(Number(totalRepsRaw)) ? Number(totalRepsRaw) : 0;
  const total_plans_shares = Number.isFinite(Number(totalPlansRaw)) ? Number(totalPlansRaw) : 0;

  return {
    data: {
      total_evals: evalIds.size,
      total_reps,
      total_plans_shares,
    },
    error: null,
  };
}

export async function getTotalPlanSharesByUserId(user_id: string): Promise<{ data: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: 0, error: new Error("Supabase client not initialized") };
  }

  const { count, error } = await client
    .from("practice_plan_invitations")
    .select("id", { count: "exact", head: true })
    .eq("invited_by", user_id);

  if (error) {
    return { data: 0, error };
  }

  return { data: count ?? 0, error: null };
}

export async function listEvaluationWorkoutProgress(
  filters: EvaluationWorkoutProgressFilters,
): Promise<{ data: EvaluationWorkoutProgressRow[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, athlete_id, evaluation_id, limit = 200, offset = 0 } = filters;

  let query = client
    .from("evaluation_workout_progress")
    .select(
      `
      id,
      org_id,
      evaluation_id,
      athlete_id,
      progress,
      level,
      organizations!inner (
        maxWorkoutReps
      )
    `,
      { count: "exact" },
    )
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id);

  if (evaluation_id) {
    query = query.eq("evaluation_id", evaluation_id);
  }

  const rangeTo = offset + (limit - 1);
  const { data, error, count } = await query.range(offset, rangeTo);
  if (error) {
    return { data: [], count: 0, error };
  }

  const mapped = (data ?? []).map((row: any) => {
    const organization = Array.isArray(row?.organizations) ? row.organizations[0] : row?.organizations;

    return {
      id: row?.id,
      org_id: row?.org_id,
      evaluation_id: row?.evaluation_id,
      athlete_id: row?.athlete_id,
      progress: row?.progress ?? null,
      level: row?.level ?? null,
      maxWorkoutReps: organization?.maxWorkoutReps ?? null,
    };
  });

  return { data: mapped, count: count ?? mapped.length, error: null };
}

export async function incrementEvaluationWorkoutProgress(
  input: EvaluationWorkoutProgressUpdateInput,
): Promise<{ data: EvaluationWorkoutProgressRow | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { org_id, athlete_id, evaluation_id } = input;

  const { data: row, error } = await client
    .from("evaluation_workout_progress")
    .select(
      `
      id,
      org_id,
      evaluation_id,
      athlete_id,
      progress,
      level,
      organizations!inner (
        maxWorkoutReps
      )
    `,
    )
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id)
    .eq("evaluation_id", evaluation_id)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  if (!row?.id) {
    return { data: null, error: new Error("Workout progress not found") };
  }

  const organization = Array.isArray(row?.organizations) ? row.organizations[0] : row?.organizations;
  const maxWorkoutRepsRaw = organization?.maxWorkoutReps;
  const maxWorkoutReps = Number(maxWorkoutRepsRaw);

  if (!Number.isFinite(maxWorkoutReps) || maxWorkoutReps <= 0) {
    return {
      data: null,
      error: new Error("maxWorkoutReps must be a positive number"),
    };
  }

  const progressValue = Number.isFinite(Number(row.progress)) ? Number(row.progress) : 0;
  const levelValue = Number.isFinite(Number(row.level)) ? Number(row.level) : 0;

  const maxProgress = maxWorkoutReps * 10;
  let nextProgress = progressValue + 1;
  let nextLevel = levelValue;

  if (nextProgress >= maxProgress) {
    nextProgress = 1;
    nextLevel = levelValue + 1;
  }

  const { data: updated, error: updateError } = await client
    .from("evaluation_workout_progress")
    .update({ progress: nextProgress, level: nextLevel })
    .eq("id", row.id)
    .select("id, org_id, evaluation_id, athlete_id, progress, level")
    .maybeSingle();

  if (updateError) {
    return { data: null, error: updateError };
  }

  if (!updated) {
    return { data: null, error: new Error("Workout progress not found") };
  }

  return {
    data: {
      id: updated.id,
      org_id: updated.org_id,
      evaluation_id: updated.evaluation_id,
      athlete_id: updated.athlete_id,
      progress: updated.progress ?? null,
      level: updated.level ?? null,
      maxWorkoutReps,
    },
    error: null,
  };
}

export async function listEvaluationWorkoutDrills(
  filters: EvaluationWorkoutDrillsFilters,
): Promise<{ data: EvaluationWorkoutDrillLevel[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, athlete_id, evaluation_id } = filters;

  const { data: progressRow, error: progressError } = await client
    .from("evaluation_workout_progress")
    .select("level, progress")
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id)
    .eq("evaluation_id", evaluation_id)
    .maybeSingle();

  if (progressError) {
    return { data: [], count: 0, error: progressError };
  }

  const level = typeof progressRow?.level === "number" && Number.isFinite(progressRow.level) ? progressRow.level : null;

  if (level === null) {
    return { data: [], count: 0, error: null };
  }

  const { data: drillRows, error: drillsError } = await client
    .from("evaluation_workout_drills")
    .select("drill_id, level")
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id)
    .eq("evaluation_id", evaluation_id)
    .eq("level", level);

  if (drillsError) {
    return { data: [], count: 0, error: drillsError };
  }

  const rows = Array.isArray(drillRows) ? drillRows : [];
  if (rows.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const drillIds = Array.from(
    new Set(
      rows
        .map((row: any) => row?.drill_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const mediaByDrill = new Map<string, { title: string; thumbnailUrl: string | null }>();
  if (drillIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await client
      .from("drill_media")
      .select("drill_id, title, thumbnail_url, sort_order, media_type")
      .in("drill_id", drillIds)
      .order("sort_order", { ascending: true });

    if (mediaError) {
      return { data: [], count: 0, error: mediaError };
    }

    for (const row of mediaRows ?? []) {
      const drillId = row?.drill_id;
      if (!drillId || mediaByDrill.has(drillId)) continue;
      mediaByDrill.set(drillId, {
        title: typeof row?.title === "string" ? row.title : "",
        thumbnailUrl: row?.thumbnail_url ?? null,
      });
    }
  }

  const targetReps =
    typeof progressRow?.progress === "number" && Number.isFinite(progressRow.progress) ? progressRow.progress : null;

  const drills: EvaluationWorkoutDrillVideo[] = rows
    .map((row: any) => {
      const drillId = row?.drill_id;
      if (typeof drillId !== "string" || !drillId) return null;
      const media = mediaByDrill.get(drillId);
      return {
        id: drillId,
        title: media?.title ?? "",
        duration: "30",
        thumbnailUrl: media?.thumbnailUrl ?? null,
      };
    })
    .filter((item: EvaluationWorkoutDrillVideo | null): item is EvaluationWorkoutDrillVideo => Boolean(item));

  return {
    data: [
      {
        level,
        title: `Level ${level}`,
        targetReps,
        drills,
      },
    ],
    count: 1,
    error: null,
  };
}

export async function listLatestEvaluationWorkoutDrills(
  filters: LatestEvaluationWorkoutDrillsFilters,
): Promise<{ data: EvaluationWorkoutDrillLevel[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, athlete_id } = filters;

  const { data: progressRow, error: progressError } = await client
    .from("evaluation_workout_progress")
    .select("evaluation_id, level, progress, created_at, updated_at")
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (progressError) {
    return { data: [], count: 0, error: progressError };
  }

  const evaluation_id =
    typeof progressRow?.evaluation_id === "string" && progressRow.evaluation_id.trim()
      ? progressRow.evaluation_id.trim()
      : null;

  const level = typeof progressRow?.level === "number" && Number.isFinite(progressRow.level) ? progressRow.level : null;

  if (!evaluation_id || level === null) {
    return { data: [], count: 0, error: null };
  }

  const { data: drillRows, error: drillsError } = await client
    .from("evaluation_workout_drills")
    .select("drill_id, level")
    .eq("org_id", org_id)
    .eq("athlete_id", athlete_id)
    .eq("evaluation_id", evaluation_id)
    .eq("level", level);

  if (drillsError) {
    return { data: [], count: 0, error: drillsError };
  }

  const rows = Array.isArray(drillRows) ? drillRows : [];
  if (rows.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const drillIds = Array.from(
    new Set(
      rows
        .map((row: any) => row?.drill_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const mediaByDrill = new Map<string, { title: string; thumbnailUrl: string | null }>();
  if (drillIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await client
      .from("drill_media")
      .select("drill_id, title, thumbnail_url, sort_order, media_type")
      .in("drill_id", drillIds)
      .order("sort_order", { ascending: true });

    if (mediaError) {
      return { data: [], count: 0, error: mediaError };
    }

    for (const row of mediaRows ?? []) {
      const drillId = row?.drill_id;
      if (!drillId || mediaByDrill.has(drillId)) continue;
      mediaByDrill.set(drillId, {
        title: typeof row?.title === "string" ? row.title : "",
        thumbnailUrl: row?.thumbnail_url ?? null,
      });
    }
  }

  const targetReps =
    typeof progressRow?.progress === "number" && Number.isFinite(progressRow.progress) ? progressRow.progress : null;

  const drills: EvaluationWorkoutDrillVideo[] = rows
    .map((row: any) => {
      const drillId = row?.drill_id;
      if (typeof drillId !== "string" || !drillId) return null;
      const media = mediaByDrill.get(drillId);
      return {
        id: drillId,
        title: media?.title ?? "",
        duration: "30",
        thumbnailUrl: media?.thumbnailUrl ?? null,
      };
    })
    .filter((item: EvaluationWorkoutDrillVideo | null): item is EvaluationWorkoutDrillVideo => Boolean(item));

  return {
    data: [
      {
        level,
        title: `Level ${level}`,
        targetReps,
        drills,
      },
    ],
    count: 1,
    error: null,
  };
}

export async function getEvaluationById(evaluationId: string, org_id: string): Promise<EvaluationDetailDto | null> {
  if (!sbAdmin) {
    throw new Error("Supabase admin client is not configured");
  }

  const { data, error } = await sbAdmin
    .from("evaluations")
    .select(
      `
      id,
      org_id,
      template_id,
      coach_id,
      teams_id,
      notes,
      created_at,
      status,
      teams:teams_id (
        id,
        name
      ),
      scorecard_templates:template_id (
        id,
        name,
        scorecard_categories (
          id,
          template_id,
          name,
          description,
          position
        )
      ),
      evaluation_items (
        id,
        evaluation_id,
        athlete_id,
        subskill_id,
        rating,
        comment,
        created_at,
        athletes:athlete_id (
          id,
          first_name,
          last_name
        )
      )
    `,
    )
    .eq("id", evaluationId)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) {
    console.error("[getEvaluationByIdService] Supabase error", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  return toEvaluationDetailDto(data);
}

export async function deleteEvaluation(
  evaluationId: string,
  org_id: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("evaluations")
    .delete()
    .eq("id", evaluationId)
    .eq("org_id", org_id)
    .select("id");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Evaluation not found") };
  }

  return { data: { id: data[0].id }, error: null };
}

export async function applyEvaluationMatrixUpdateService(dto: EvaluationMatrixUpdateDto): Promise<EvaluationDetailDto> {
  if (!sbAdmin) {
    throw new Error("Supabase admin client is not configured");
  }

  const evaluationId = dto.evaluation_id;
  const org_id = dto.org_id;
  if (!org_id) {
    throw new Error("org_id (UUID) is required");
  }

  const { data: evaluationRow, error: evaluationError } = await sbAdmin
    .from("evaluations")
    .select("id")
    .eq("id", evaluationId)
    .eq("org_id", org_id)
    .maybeSingle();

  if (evaluationError) {
    throw evaluationError;
  }

  if (!evaluationRow) {
    throw new Error("Evaluation not found");
  }

  // 1) Optionally patch the evaluation header row
  const patch: Record<string, unknown> = {};
  if (dto.org_id !== undefined) patch.org_id = dto.org_id;
  if (dto.template_id !== undefined) patch.template_id = dto.template_id;
  if (dto.team_id !== undefined) patch.teams_id = dto.team_id;
  if (dto.coach_id !== undefined) patch.coach_id = dto.coach_id;
  if (dto.notes !== undefined) patch.notes = dto.notes;

  if (Object.keys(patch).length > 0) {
    const { error: headerError } = await sbAdmin
      .from("evaluations")
      .update(patch)
      .eq("id", evaluationId)
      .eq("org_id", org_id);

    if (headerError) {
      console.error("[applyEvaluationMatrixUpdateService] header update error", headerError);
      throw headerError;
    }
  }

  // 2) Apply item-level operations
  for (const op of dto.operations) {
    if (op.type === "remove_athlete") {
      const { error } = await sbAdmin
        .from("evaluation_items")
        .delete()
        .eq("evaluation_id", evaluationId)
        .eq("athlete_id", op.athlete_id);

      if (error) {
        console.error("[applyEvaluationMatrixUpdateService] remove_athlete error", error);
        throw error;
      }
      continue;
    }

    if (op.type === "upsert_rating") {
      // rating null => delete row for this (evaluation, athlete, subskill)
      if (op.rating === null || op.rating === undefined || Number.isNaN(Number(op.rating))) {
        const { error } = await sbAdmin
          .from("evaluation_items")
          .delete()
          .eq("evaluation_id", evaluationId)
          .eq("athlete_id", op.athlete_id)
          .eq("subskill_id", op.subskill_id);

        if (error) {
          console.error("[applyEvaluationMatrixUpdateService] delete rating error", error);
          throw error;
        }
        continue;
      }

      const rating = Number(op.rating);

      // Check if item exists
      const { data: existing, error: selectError } = await sbAdmin
        .from("evaluation_items")
        .select("id")
        .eq("evaluation_id", evaluationId)
        .eq("athlete_id", op.athlete_id)
        .eq("subskill_id", op.subskill_id)
        .maybeSingle();

      if (selectError) {
        console.error("[applyEvaluationMatrixUpdateService] select existing item error", selectError);
        throw selectError;
      }

      if (existing) {
        // UPDATE existing
        const { error: updateError } = await sbAdmin
          .from("evaluation_items")
          .update({
            rating,
            comment: op.comments ?? null,
          })
          .eq("id", existing.id);

        if (updateError) {
          console.error("[applyEvaluationMatrixUpdateService] update rating error", updateError);
          throw updateError;
        }
      } else {
        // INSERT new
        const { error: insertError } = await sbAdmin.from("evaluation_items").insert({
          evaluation_id: evaluationId,
          athlete_id: op.athlete_id,
          subskill_id: op.subskill_id,
          rating,
          comment: op.comments ?? null,
          recommended_skill_id: null,
        });

        if (insertError) {
          console.error("[applyEvaluationMatrixUpdateService] insert rating error", insertError);
          throw insertError;
        }
      }
    }
  }

  // 3) Return the fresh evaluation detail (same shape as GET /eval/:id)
  const updated = await getEvaluationById(evaluationId, org_id);
  if (!updated) {
    throw new Error("Evaluation not found after matrix update");
  }

  return updated;
}

export async function submitEvaluation(evaluationId: string, org_id: string): Promise<SubmitEvaluationResult> {
  const toError = (err: unknown): Error => {
    if (err instanceof Error) return err;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return new Error(msg);
    }
    return new Error(typeof err === "string" ? err : JSON.stringify(err));
  };

  const { data, error } = await sbAdmin!.rpc("submit_evaluation_tx", {
    p_evaluation_id: evaluationId,
    p_org_id: org_id,
  });

  if (error) return { ok: false, error: toError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.id) {
    return { ok: false, error: new Error("Evaluation not found") };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      status: row.status,
    },
  };
}

type EvaluationReportRecipient = {
  email: string;
  athleteFirstName: string | null;
};

type EvaluationReportContext = {
  evaluationTitle: string;
  evaluationDate: string;
  coachName: string;
  teamOrOrgName: string;
  evaluationLink: string;
};

function formatEvaluationReportDate(value: string | null): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function buildEvaluationLink(evaluationId: string): string {
  const base = (INVITE_REDIRECT_URL ?? "").trim().replace(/\/+$/g, "");
  if (!base) return evaluationId;
  return `${base}/reports/evaluation-reports/${evaluationId}`;
}

async function getEvaluationReportContext(evaluationId: string, org_id: string): Promise<EvaluationReportContext> {
  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const { data, error } = await client
    .from("evaluations")
    .select(
      `
      id,
      created_at,
      coach:coaches (
        full_name
      ),
      template:scorecard_templates (
        name
      ),
      team:teams (
        name
      )
    `,
    )
    .eq("id", evaluationId)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Evaluation not found");
  }

  const coachName =
    typeof data?.coach?.full_name === "string" && data.coach.full_name.trim()
      ? data.coach.full_name.trim()
      : "your coach";

  const evaluationTitle =
    typeof data?.template?.name === "string" && data.template.name.trim() ? data.template.name.trim() : "Evaluation";

  const teamOrOrgName =
    typeof data?.team?.name === "string" && data.team.name.trim() ? data.team.name.trim() : "your organization";

  return {
    coachName,
    evaluationTitle,
    evaluationDate: formatEvaluationReportDate(data?.created_at ?? null),
    teamOrOrgName,
    evaluationLink: buildEvaluationLink(evaluationId),
  };
}

async function listEvaluationReportRecipients(evaluationId: string): Promise<EvaluationReportRecipient[]> {
  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const { data, error } = await client
    .from("evaluation_items")
    .select(
      `
      athlete:athletes!inner (
        first_name,
        profiles!inner (
          email,
          first_name
        )
      )
    `,
    )
    .eq("evaluation_id", evaluationId);

  if (error) {
    throw error;
  }

  const recipients: EvaluationReportRecipient[] = [];
  const seenEmails = new Set<string>();

  for (const row of data ?? []) {
    const athlete = (row as any)?.athlete;
    if (!athlete) continue;

    const profileRaw = Array.isArray(athlete?.profiles) ? athlete.profiles[0] : athlete?.profiles;
    const email = typeof profileRaw?.email === "string" && profileRaw.email.trim() ? profileRaw.email.trim() : "";
    if (!email) continue;

    const normalizedEmail = email.toLowerCase();
    if (seenEmails.has(normalizedEmail)) continue;
    seenEmails.add(normalizedEmail);

    const athleteFirstName =
      typeof athlete?.first_name === "string" && athlete.first_name.trim()
        ? athlete.first_name.trim()
        : typeof profileRaw?.first_name === "string" && profileRaw.first_name.trim()
          ? profileRaw.first_name.trim()
          : null;

    recipients.push({
      email: normalizedEmail,
      athleteFirstName,
    });
  }

  return recipients;
}

export async function buildEvaluationReportEmailInputs(
  evaluationId: string,
  org_id: string,
): Promise<{ data: EvaluationReportEmailInput[]; error: unknown | null }> {
  try {
    const [context, recipients] = await Promise.all([
      getEvaluationReportContext(evaluationId, org_id),
      listEvaluationReportRecipients(evaluationId),
    ]);

    if (recipients.length === 0) {
      return { data: [], error: null };
    }

    const items: EvaluationReportEmailInput[] = recipients.map((recipient) => ({
      to: recipient.email,
      athleteFirstName: recipient.athleteFirstName,
      coachName: context.coachName,
      evaluationTitle: context.evaluationTitle,
      evaluationDate: context.evaluationDate,
      teamOrOrgName: context.teamOrOrgName,
      evaluationLink: context.evaluationLink,
    }));

    return { data: items, error: null };
  } catch (err) {
    return { data: [], error: err };
  }
}
