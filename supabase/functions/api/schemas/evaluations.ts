// src/schemas/evaluations.ts

export interface EvaluationItemInput {
  skill_id: string;
  rating: number;
  comments?: string | null;
}

export interface EvaluationInput {
  org_id: string;
  scorecard_template_id: string;
  team_id?: string | null; // NEW: maps to evaluations.teams_id
  athlete_id: string; // still sent in payload, now stored on evaluation_items
  coach_id: string;
  notes?: string | null;
  evaluation_items: EvaluationItemInput[];
}

export interface EvaluationWithItems {
  id: string;
  org_id: string;
  scorecard_template_id: string;
  team_id: string | null; // NEW: from evaluations.teams_id
  coach_id: string;
  notes: string | null;
  created_at: string;
  evaluation_items: {
    id: string;
    evaluation_id: string;
    athlete_id: string; // NEW: from evaluation_items.athlete_id
    skill_id: string;
    rating: number;
    comments: string | null;
    created_at: string;
  }[];
}
