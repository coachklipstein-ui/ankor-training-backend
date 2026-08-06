SET check_function_bodies = false;
ALTER TABLE public.athlete_positions DROP COLUMN "position";
CREATE OR REPLACE FUNCTION public.evaluations_bulk_create_tx(evaluations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_eval jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_item_rating numeric;
  v_item_comment text;
  v_item_created_at timestamptz;
  v_evaluation_id uuid;
  v_result jsonb := '[]'::jsonb;
  v_items jsonb;
begin
  if evaluations is null or jsonb_typeof(evaluations) <> 'array' then
    raise exception 'EVALUATIONS_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;

  for v_eval in select value from jsonb_array_elements(evaluations)
  loop
    insert into public.evaluations (
      org_id,
      template_id,
      teams_id,
      coach_id,
      notes,
      status
    )
    values (
      (v_eval->>'org_id')::uuid,
      (v_eval->>'scorecard_template_id')::uuid,
      nullif(v_eval->>'team_id', '')::uuid,
      (v_eval->>'coach_id')::uuid,
      nullif(v_eval->>'notes', ''),
      'not_started'
    )
    returning id into v_evaluation_id;

    v_items := '[]'::jsonb;
    for v_item in select value from jsonb_array_elements(coalesce(v_eval->'evaluation_items', '[]'::jsonb))
    loop
      insert into public.evaluation_items (
        evaluation_id,
        athlete_id,
        subskill_id,
        rating,
        comment
      )
      values (
        v_evaluation_id,
        (v_item->>'athlete_id')::uuid,
        (v_item->>'skill_id')::uuid,
        nullif(v_item->>'rating', '')::numeric,
        nullif(coalesce(v_item->>'comments', v_item->>'comment'), '')
      )
      returning id, rating, comment, created_at
        into v_item_id, v_item_rating, v_item_comment, v_item_created_at;

      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_item_id,
        'evaluation_id', v_evaluation_id,
        'athlete_id', v_item->>'athlete_id',
        'subskill_id', v_item->>'skill_id',
        'rating', v_item_rating,
        'comment', v_item_comment,
        'created_at', v_item_created_at
      ));
    end loop;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_evaluation_id,
      'org_id', v_eval->>'org_id',
      'template_id', v_eval->>'scorecard_template_id',
      'teams_id', nullif(v_eval->>'team_id', ''),
      'coach_id', v_eval->>'coach_id',
      'notes', nullif(v_eval->>'notes', ''),
      'created_at', now(),
      'evaluation_items', v_items
    ));
  end loop;

  return v_result;
end;
$function$;
CREATE FUNCTION public.get_coach_summary(p_org_id uuid, p_coach_id uuid)
 RETURNS TABLE(total_teams bigint, total_athletes bigint, total_evaluations bigint, total_plans_share bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with coach_teams as (
    select t.id
    from public.teams t
    where t.coach_id = p_coach_id
      and t.org_id = p_org_id
  )
  select
    coalesce((
      select count(*)
      from coach_teams
    ), 0)::bigint as total_teams,
    coalesce((
      select count(*)
      from public.team_memberships tm
      where tm.team_id in (select id from coach_teams)
    ), 0)::bigint as total_athletes,
    coalesce((
      select count(*)
      from public.evaluations e
      where e.coach_id = p_coach_id
        and e.org_id = p_org_id
        and e.status = 'completed'
    ), 0)::bigint as total_evaluations,
    coalesce((
      select count(*)
      from public.practice_plan_invitations ppi
      where ppi.invited_by = p_coach_id
    ), 0)::bigint as total_plans_share;
$function$;
CREATE FUNCTION public.get_workout_summary(p_org_id uuid, p_athlete_id uuid, p_user_id uuid)
 RETURNS TABLE(total_evals bigint, total_reps bigint, total_plans_shares bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((
      select count(distinct ei.evaluation_id)
      from public.evaluation_items ei
      inner join public.evaluations e
        on e.id = ei.evaluation_id
      where ei.athlete_id = p_athlete_id
        and e.org_id = p_org_id
    ), 0)::bigint as total_evals,
    coalesce((
      select sum(ewp.progress)
      from public.evaluation_workout_progress ewp
      where ewp.org_id = p_org_id
        and ewp.athlete_id = p_athlete_id
    ), 0)::bigint as total_reps,
    coalesce((
      select count(*)
      from public.practice_plan_invitations ppi
      where ppi.invited_by = p_user_id
    ), 0)::bigint as total_plans_shares;
$function$;
CREATE FUNCTION public.sum_evaluation_workout_progress(p_org_id uuid, p_athlete_id uuid)
 RETURNS TABLE(total_reps bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(progress), 0)::bigint as total_reps
  from public.evaluation_workout_progress
  where org_id = p_org_id
    and athlete_id = p_athlete_id;
$function$;
ALTER TABLE public.athlete_guardians REPLICA IDENTITY FULL;
ALTER TABLE public.athlete_positions ADD CONSTRAINT athlete_positions_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON DELETE CASCADE;
ALTER TABLE public.athletes REPLICA IDENTITY FULL;
ALTER TABLE public.athletes VALIDATE CONSTRAINT athletes_user_id_profiles_user_id_fkey;
ALTER TABLE public.coaches REPLICA IDENTITY FULL;
ALTER TABLE public.coaches VALIDATE CONSTRAINT coaches_user_id_profiles_user_id_fkey;
ALTER TABLE public.drill_media REPLICA IDENTITY FULL;
ALTER TABLE public.drills REPLICA IDENTITY FULL;
ALTER TABLE public.evaluation_items REPLICA IDENTITY FULL;
ALTER TABLE public.evaluation_workout_drills REPLICA IDENTITY FULL;
ALTER TABLE public.evaluation_workout_progress REPLICA IDENTITY FULL;
ALTER TABLE public.evaluations REPLICA IDENTITY FULL;
ALTER TABLE public.guardian_contacts REPLICA IDENTITY FULL;
ALTER TABLE public.join_codes REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.practice_plan_invitations REPLICA IDENTITY FULL;
ALTER TABLE public.practice_plan_items REPLICA IDENTITY FULL;
ALTER TABLE public.practice_plan_members REPLICA IDENTITY FULL;
ALTER TABLE public.practice_plans REPLICA IDENTITY FULL;
ALTER TABLE public.scorecard_categories REPLICA IDENTITY FULL;
ALTER TABLE public.scorecard_subskills REPLICA IDENTITY FULL;
ALTER TABLE public.scorecard_templates REPLICA IDENTITY FULL;
CREATE INDEX idx_skill_drill_map_org_id ON public.skill_drill_map (org_id);
CREATE INDEX idx_skill_drill_map_org_skill ON public.skill_drill_map (org_id, skill_id);
ALTER TABLE public.skill_media REPLICA IDENTITY FULL;
ALTER TABLE public.skills REPLICA IDENTITY FULL;
ALTER TABLE public.team_athletes REPLICA IDENTITY FULL;
ALTER TABLE public.teams REPLICA IDENTITY FULL;
