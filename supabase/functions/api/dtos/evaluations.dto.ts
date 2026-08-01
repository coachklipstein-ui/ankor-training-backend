export interface EvaluationItemDto {
  id: string;
  evaluation_id: string;
  athlete_id: string;
  athlete_first_name: string | null;
  athlete_last_name: string | null;
  subskill_id: string;
  rating: number | null;
  comment: string | null;
  created_at: string;
}

export interface EvaluationAthleteDto {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

export interface ScorecardCategoryDto {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  position: number | null;
}

export interface EvaluationDetailDto {
  id: string;
  org_id: string;
  template_id: string;
  template_name: string | null;
  coach_id: string;
  teams_id: string | null;
  team_name: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
  evaluation_items: EvaluationItemDto[];
  athletes: EvaluationAthleteDto[];
  categories: ScorecardCategoryDto[];
}

// Mapper from raw Supabase row -> clean DTO
export function toEvaluationDetailDto(raw: any): EvaluationDetailDto {
  const team = raw.teams ?? null;
  const template = raw.scorecard_templates ?? raw.template ?? raw.templates ?? null;

  const athleteMap = new Map<string, EvaluationAthleteDto>();

  const evaluation_items: EvaluationItemDto[] = (raw.evaluation_items ?? []).map((item: any) => {
    const athlete = item.athletes ?? null;

    if (athlete && athlete.id && !athleteMap.has(athlete.id)) {
      athleteMap.set(athlete.id, {
        id: athlete.id,
        first_name: athlete.first_name ?? null,
        last_name: athlete.last_name ?? null,
      });
    }

    return {
      id: item.id,
      evaluation_id: item.evaluation_id,
      athlete_id: item.athlete_id,
      athlete_first_name: athlete?.first_name ?? null,
      athlete_last_name: athlete?.last_name ?? null,
      subskill_id: item.subskill_id,
      rating: item.rating,
      comment: item.comment ?? null,
      created_at: item.created_at,
    };
  });

  const categories: ScorecardCategoryDto[] = (template?.scorecard_categories ?? template?.categories ?? []).map(
    (cat: any) => ({
      id: cat.id,
      template_id: cat.template_id,
      name: cat.name,
      description: cat.description ?? null,
      position: cat.position ?? null,
    }),
  );

  return {
    id: raw.id,
    org_id: raw.org_id,
    template_id: raw.template_id,
    template_name: template?.name ?? null,
    coach_id: raw.coach_id,
    teams_id: raw.teams_id ?? null,
    team_name: team?.name ?? null,
    status: raw.status ?? "not_started",
    notes: raw.notes ?? null,
    created_at: raw.created_at,
    evaluation_items,
    athletes: Array.from(athleteMap.values()),
    categories,
  };
}

// ---------- Matrix update operations for an evaluation ----------

export type EvaluationMatrixOperationType = "upsert_rating" | "remove_athlete";

export interface EvaluationMatrixUpsertRatingOpDto {
  type: "upsert_rating";
  athlete_id: string;
  subskill_id: string;
  rating: number | null;
  comments?: string | null;
}

export interface EvaluationMatrixRemoveAthleteOpDto {
  type: "remove_athlete";
  athlete_id: string;
}

export type EvaluationMatrixOperationDto = EvaluationMatrixUpsertRatingOpDto | EvaluationMatrixRemoveAthleteOpDto;

export interface EvaluationMatrixUpdateDto {
  evaluation_id: string;

  org_id: string;
  template_id?: string;
  team_id?: string | null;
  coach_id?: string;
  notes?: string | null;

  // ✅ NEW (if you want to patch status via the same endpoint)
  status?: EvaluationStatus;

  operations: EvaluationMatrixOperationDto[];
}
