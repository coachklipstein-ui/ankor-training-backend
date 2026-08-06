SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
COMMENT ON SCHEMA "public" IS 'standard public schema';
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE TYPE "public"."lax_position" AS ENUM (
    'attack',
    'midfield',
    'defense',
    'goalie',
    'draw',
    'faceoff',
    'lsm',
    'fogo'
);
ALTER TYPE "public"."lax_position" OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_athlete_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_team_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text", "p_gender" "text", "p_guardian_id" "uuid", "p_guardian_user_id" "uuid", "p_guardian_full_name" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_guardian_relationship" "text", "p_graduation_year" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_full_name text;
  v_athlete_id uuid;
  v_guardian_id uuid;
  v_same_email boolean;
  v_has_guardian boolean;
begin
  v_full_name := nullif(trim(coalesce(p_full_name, '')), '');
  if v_full_name is null then
    v_full_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');
  end if;

  v_same_email := p_guardian_email is not null
    and p_email is not null
    and lower(p_guardian_email) = lower(p_email);

  insert into public.profiles (
    id,
    user_id,
    full_name,
    default_org_id,
    phone,
    first_name,
    last_name,
    email,
    role
  )
  values (
    p_user_id,
    p_user_id,
    case when v_same_email then p_guardian_full_name else v_full_name end,
    p_org_id,
    case
      when v_same_email then p_guardian_phone
      else coalesce(p_phone, p_cell_number)
    end,
    case when v_same_email then null else p_first_name end,
    case when v_same_email then null else p_last_name end,
    case when v_same_email then p_guardian_email else p_email end,
    case when v_same_email then 'parent' else 'athlete' end
  )
  on conflict (id) do update
    set
      full_name = excluded.full_name,
      phone = excluded.phone,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = excluded.email,
      role = excluded.role
    where excluded.role = 'parent';

  insert into public.org_memberships (org_id, user_id, role, is_active)
  values (p_org_id, p_user_id, 'athlete', true)
  on conflict (org_id, user_id) do update
    set role = case
      when org_memberships.role = 'parent' then org_memberships.role
      else excluded.role
    end,
    is_active = true;

  insert into public.athletes (
    org_id,
    user_id,
    first_name,
    last_name,
    full_name,
    email,
    phone,
    cell_number,
    gender,
    graduation_year
  )
  values (
    p_org_id,
    p_user_id,
    p_first_name,
    p_last_name,
    v_full_name,
    p_email,
    p_phone,
    p_cell_number,
    p_gender,
    p_graduation_year
  )
  returning id into v_athlete_id;

  insert into public.team_memberships (team_id, athlete_id, created_at)
  select p_team_id, v_athlete_id, now()
  where not exists (
    select 1
    from public.team_memberships
    where team_id = p_team_id
      and athlete_id = v_athlete_id
  );

  insert into public.team_athletes (team_id, athlete_id, status)
  values (p_team_id, v_athlete_id, 'active')
  on conflict (team_id, athlete_id) do update
    set status = excluded.status;

  v_has_guardian := p_guardian_id is not null
    or p_guardian_user_id is not null
    or p_guardian_full_name is not null
    or p_guardian_email is not null
    or p_guardian_phone is not null
    or p_guardian_relationship is not null;

  if not v_has_guardian then
    return v_athlete_id;
  end if;

  v_guardian_id := p_guardian_id;
  if v_guardian_id is null then
    if p_guardian_phone is not null then
      select id
      into v_guardian_id
      from public.guardian_contacts
      where org_id = p_org_id
        and phone = p_guardian_phone
      limit 1;
    end if;

    if v_guardian_id is null and p_guardian_email is not null then
      select id
      into v_guardian_id
      from public.guardian_contacts
      where org_id = p_org_id
        and lower(email) = lower(p_guardian_email)
      limit 1;
    end if;
  end if;

  if v_guardian_id is null then
    if p_guardian_user_id is null then
      raise exception 'guardian user id is required';
    end if;

    insert into public.profiles (
      id,
      user_id,
      full_name,
      default_org_id,
      phone,
      email,
      role
    )
    values (
      p_guardian_user_id,
      p_guardian_user_id,
      p_guardian_full_name,
      p_org_id,
      p_guardian_phone,
      p_guardian_email,
      'parent'
    )
    on conflict (id) do nothing;

    if p_guardian_user_id <> p_user_id then
      insert into public.org_memberships (org_id, user_id, role, is_active)
      values (p_org_id, p_guardian_user_id, 'parent', true)
      on conflict (org_id, user_id) do update
        set role = excluded.role,
            is_active = true;
    end if;

    insert into public.guardian_contacts (
      org_id,
      user_id,
      full_name,
      email,
      phone
    )
    values (
      p_org_id,
      p_guardian_user_id,
      p_guardian_full_name,
      p_guardian_email,
      p_guardian_phone
    )
    returning id into v_guardian_id;
  end if;

  insert into public.athlete_guardians (athlete_id, guardian_id, relationship)
  values (v_athlete_id, v_guardian_id, p_guardian_relationship)
  on conflict (athlete_id, guardian_id) do update
    set relationship = excluded.relationship;

  return v_athlete_id;
end;
$$;
ALTER FUNCTION "public"."create_athlete_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_team_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text", "p_gender" "text", "p_guardian_id" "uuid", "p_guardian_user_id" "uuid", "p_guardian_full_name" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_guardian_relationship" "text", "p_graduation_year" integer) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_coach_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_full_name text;
  v_coach_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_org_id is null then
    raise exception 'p_org_id is required';
  end if;

  v_full_name := nullif(trim(coalesce(p_full_name, '')), '');
  if v_full_name is null then
    v_full_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');
  end if;

  insert into public.profiles (
    id,
    user_id,
    full_name,
    default_org_id,
    phone,
    first_name,
    last_name,
    email,
    role
  )
  values (
    p_user_id,
    p_user_id,
    v_full_name,
    p_org_id,
    coalesce(nullif(trim(p_phone), ''), nullif(trim(p_cell_number), '')),
    nullif(trim(p_first_name), ''),
    nullif(trim(p_last_name), ''),
    nullif(trim(p_email), ''),
    'coach'
  )
  on conflict (id) do update
    set
      full_name = excluded.full_name,
      default_org_id = excluded.default_org_id,
      phone = excluded.phone,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = excluded.email,
      role = excluded.role;

  update public.org_memberships om
  set role = 'coach',
      is_active = true
  where om.org_id = p_org_id
    and om.user_id = p_user_id;

  if not found then
    insert into public.org_memberships (org_id, user_id, role, is_active)
    values (p_org_id, p_user_id, 'coach', true);
  end if;

  insert into public.coaches (
    org_id,
    user_id,
    full_name,
    email,
    phone,
    cell_number
  )
  values (
    p_org_id,
    p_user_id,
    v_full_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), ''),
    nullif(trim(p_cell_number), '')
  )
  returning id into v_coach_id;

  return v_coach_id;
end;
$$;
ALTER FUNCTION "public"."create_coach_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_guardian_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_athlete_ids" "uuid"[], "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_address_line1" "text", "p_address_line2" "text", "p_city" "text", "p_region" "text", "p_postal_code" "text", "p_country" "text", "p_relationship" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_guardian_id uuid;
begin
  insert into public.guardian_contacts (
    org_id,
    user_id,
    full_name,
    email,
    phone,
    address_line1,
    address_line2,
    city,
    region,
    postal_code,
    country
  )
  values (
    p_org_id,
    p_user_id,
    p_full_name,
    p_email,
    p_phone,
    p_address_line1,
    p_address_line2,
    p_city,
    p_region,
    p_postal_code,
    p_country
  )
  returning id into v_guardian_id;

  insert into public.org_memberships (org_id, user_id, role, is_active)
  values (p_org_id, p_user_id, 'parent', true)
  on conflict (org_id, user_id) do update
    set role = excluded.role,
        is_active = true;

  insert into public.profiles (
    id,
    user_id,
    full_name,
    default_org_id,
    phone,
    email,
    role
  )
  values (
    p_user_id,
    p_user_id,
    p_full_name,
    p_org_id,
    p_phone,
    p_email,
    'parent'
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        default_org_id = excluded.default_org_id,
        phone = excluded.phone,
        email = excluded.email,
        role = excluded.role;

  insert into public.athlete_guardians (athlete_id, guardian_id, relationship)
  select distinct unnest(p_athlete_ids), v_guardian_id, p_relationship
  on conflict (athlete_id, guardian_id) do update
    set relationship = excluded.relationship;

  return v_guardian_id;
end;
$$;
ALTER FUNCTION "public"."create_guardian_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_athlete_ids" "uuid"[], "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_address_line1" "text", "p_address_line2" "text", "p_city" "text", "p_region" "text", "p_postal_code" "text", "p_country" "text", "p_relationship" "text") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_scorecard_template_tx"("p_template" "jsonb", "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("template_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_template_id uuid;
  v_category jsonb;
  v_subskill jsonb;
  v_category_id uuid;
begin
  if p_template is null then
    raise exception 'TEMPLATE_REQUIRED' using errcode = 'P0001';
  end if;
  if nullif(p_template->>'org_id', '') is null then
    raise exception 'ORG_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_template->>'name'), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_template->'categories', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_template->'categories', '[]'::jsonb)) = 0 then
    raise exception 'AT_LEAST_ONE_CATEGORY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.scorecard_templates (
    org_id,
    sport_id,
    name,
    description,
    is_active,
    created_by
  )
  values (
    (p_template->>'org_id')::uuid,
    nullif(p_template->>'sport_id', '')::uuid,
    trim(p_template->>'name'),
    nullif(p_template->>'description', ''),
    coalesce((p_template->>'isActive')::boolean, true),
    p_created_by
  )
  returning id into v_template_id;

  for v_category in select value from jsonb_array_elements(p_template->'categories')
  loop
    if jsonb_typeof(coalesce(v_category->'subskills', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_category->'subskills', '[]'::jsonb)) = 0 then
      raise exception 'CATEGORY_NEEDS_ONE_SUBSKILL' using errcode = 'P0001';
    end if;

    insert into public.scorecard_categories (
      template_id,
      name,
      description,
      position
    )
    values (
      v_template_id,
      trim(v_category->>'name'),
      nullif(v_category->>'description', ''),
      coalesce(nullif(v_category->>'position', '')::integer, 1)
    )
    returning id into v_category_id;

    for v_subskill in select value from jsonb_array_elements(v_category->'subskills')
    loop
      if nullif(v_subskill->>'skill_id', '') is null then
        raise exception 'SUBSKILL_SKILL_REQUIRED' using errcode = 'P0001';
      end if;

      insert into public.scorecard_subskills (
        category_id,
        name,
        description,
        position,
        skill_id,
        rating_min,
        rating_max
      )
      values (
        v_category_id,
        trim(v_subskill->>'name'),
        nullif(v_subskill->>'description', ''),
        coalesce(nullif(v_subskill->>'position', '')::integer, 1),
        (v_subskill->>'skill_id')::uuid,
        1,
        5
      );
    end loop;
  end loop;

  return query select v_template_id;
end;
$$;
ALTER FUNCTION "public"."create_scorecard_template_tx"("p_template" "jsonb", "p_created_by" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."evaluations_bulk_create_tx"("evaluations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;
ALTER FUNCTION "public"."evaluations_bulk_create_tx"("evaluations" "jsonb") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."list_evaluation_skill_videos"("p_evaluation_id" "uuid", "p_org_id" "uuid", "p_athlete_id" "uuid", "p_rating_max" numeric DEFAULT 3) RETURNS TABLE("evaluation_id" "uuid", "skill_id" "uuid", "title" "text", "url" "text", "rating" numeric, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    items.evaluation_id,
    media.skill_id,
    skills.title,
    media.url,
    items.rating::numeric as rating,
    items.created_at
  from public.evaluations evals
  inner join public.evaluation_items items
    on evals.id = items.evaluation_id
  left join public.scorecard_subskills subskills
    on items.subskill_id = subskills.id
  inner join public.skill_media media
    on media.skill_id = coalesce(subskills.skill_id, items.subskill_id)
  inner join public.skills skills
    on media.skill_id = skills.id
  where evals.id = p_evaluation_id
    and evals.org_id = p_org_id
    and items.athlete_id = p_athlete_id
    and items.rating < p_rating_max
    and media.media_type = 'video'
  order by items.created_at desc, media.sort_order asc nulls last;
$$;
ALTER FUNCTION "public"."list_evaluation_skill_videos"("p_evaluation_id" "uuid", "p_org_id" "uuid", "p_athlete_id" "uuid", "p_rating_max" numeric) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."rpc_create_drill"("p_drill" "jsonb", "p_media" "jsonb" DEFAULT '[]'::"jsonb", "p_skill_tags" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS TABLE("drill_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_drill_id uuid;
  v_duration_seconds integer;
  v_media jsonb;
  v_tag uuid;
begin
  if p_drill is null or coalesce(trim(p_drill->>'name'), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;

  v_duration_seconds := nullif(p_drill->>'duration_seconds', '')::integer;

  insert into public.drills (
    org_id,
    segment_id,
    sport_id,
    name,
    description,
    coaching_points,
    level,
    min_age,
    max_age,
    duration_min,
    created_by
  )
  values (
    (p_drill->>'org_id')::uuid,
    nullif(p_drill->>'segment_id', '')::uuid,
    nullif(p_drill->>'sport_id', '')::uuid,
    trim(p_drill->>'name'),
    nullif(p_drill->>'description', ''),
    nullif(p_drill->>'instructions', ''),
    nullif(p_drill->>'level', ''),
    nullif(p_drill->>'min_age', '')::integer,
    nullif(p_drill->>'max_age', '')::integer,
    case when v_duration_seconds is null then null else ceil(v_duration_seconds / 60.0)::integer end,
    nullif(p_drill->>'created_by', '')::uuid
  )
  returning id into v_drill_id;

  for v_media in select value from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
  loop
    insert into public.drill_media (
      drill_id,
      media_type,
      url,
      title,
      thumbnail_url,
      sort_order
    )
    values (
      v_drill_id,
      coalesce(nullif(v_media->>'type', ''), 'video'),
      v_media->>'url',
      nullif(v_media->>'title', ''),
      nullif(v_media->>'thumbnail_url', ''),
      nullif(v_media->>'position', '')::integer
    );
  end loop;

  foreach v_tag in array coalesce(p_skill_tags, '{}')
  loop
    insert into public.drill_tag_map (drill_id, tag_id)
    values (v_drill_id, v_tag)
    on conflict do nothing;
  end loop;

  return query select v_drill_id;
end;
$$;
ALTER FUNCTION "public"."rpc_create_drill"("p_drill" "jsonb", "p_media" "jsonb", "p_skill_tags" "uuid"[]) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;
ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."signup_register_athlete_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_graduation_year" integer, "p_cell_number" "text", "p_positions" "uuid"[], "p_terms_accepted" boolean) RETURNS TABLE("org_id" "uuid", "team_id" "uuid", "athlete_id" "uuid", "profile_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_profile_id uuid;
  v_athlete_id uuid;
  v_org_id uuid;
  v_team_id uuid;
  v_has_uses_count boolean := false;
  v_has_used_count boolean := false;
begin
  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'FIRST_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'LAST_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'EMAIL_REQUIRED' using errcode = 'P0001';
  end if;
  if p_graduation_year is null then
    raise exception 'GRADUATION_YEAR_REQUIRED' using errcode = 'P0001';
  end if;
  if p_positions is null or array_length(p_positions, 1) is null then
    raise exception 'POSITION_REQUIRED' using errcode = 'P0001';
  end if;
  if not p_terms_accepted then
    raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
  end if;

  select jc.org_id, jc.team_id
    into v_org_id, v_team_id
  from public.join_codes as jc
  where jc.code::text = p_code
    and coalesce(jc.is_active, true)
    and not coalesce(jc.disabled, false)
    and (jc.expires_at is null or jc.expires_at > now())
  for update;

  if not found then
    raise exception 'INVALID_JOIN_CODE' using errcode = 'P0001';
  end if;

  insert into public.profiles as pr (
    id,
    user_id,
    first_name,
    last_name,
    full_name,
    default_org_id,
    email,
    phone,
    role,
    terms_accepted,
    terms_accepted_at
  )
  values (
    p_user_id,
    p_user_id,
    btrim(p_first_name),
    btrim(p_last_name),
    btrim(p_first_name || ' ' || p_last_name),
    v_org_id,
    lower(p_email),
    nullif(btrim(p_cell_number), ''),
    'athlete',
    p_terms_accepted,
    case when p_terms_accepted then now() else null end
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        default_org_id = excluded.default_org_id,
        email = excluded.email,
        phone = excluded.phone,
        role = 'athlete',
        user_id = excluded.user_id,
        terms_accepted = excluded.terms_accepted,
        terms_accepted_at = excluded.terms_accepted_at
  returning pr.id into v_profile_id;

  insert into public.org_memberships (org_id, user_id, role, is_active)
  values (v_org_id, p_user_id, 'athlete', true)
  on conflict (org_id, user_id) do update
    set role = case
      when org_memberships.role = 'parent' then org_memberships.role
      else excluded.role
    end,
    is_active = true;

  select a.id
    into v_athlete_id
  from public.athletes as a
  where a.org_id = v_org_id
    and a.user_id = p_user_id
  limit 1;

  if v_athlete_id is null then
    insert into public.athletes as a (
      org_id,
      user_id,
      graduation_year,
      cell_number,
      first_name,
      last_name,
      full_name,
      email,
      phone
    )
    values (
      v_org_id,
      p_user_id,
      p_graduation_year,
      nullif(btrim(p_cell_number), ''),
      btrim(p_first_name),
      btrim(p_last_name),
      btrim(p_first_name || ' ' || p_last_name),
      lower(p_email),
      nullif(btrim(p_cell_number), '')
    )
    returning a.id into v_athlete_id;
  else
    update public.athletes as a
      set org_id = v_org_id,
          graduation_year = p_graduation_year,
          cell_number = nullif(btrim(p_cell_number), ''),
          first_name = btrim(p_first_name),
          last_name = btrim(p_last_name),
          full_name = btrim(p_first_name || ' ' || p_last_name),
          email = lower(p_email),
          phone = nullif(btrim(p_cell_number), '')
    where a.id = v_athlete_id;
  end if;

  delete from public.athlete_positions as ap
  where ap.athlete_id = v_athlete_id;

  insert into public.athlete_positions (athlete_id, position_id)
  select v_athlete_id, position_id
  from unnest(p_positions) as position_id;

  if v_team_id is not null then
    insert into public.team_memberships (team_id, athlete_id, created_at)
    select v_team_id, v_athlete_id, now()
    where not exists (
      select 1
      from public.team_memberships as tm
      where tm.team_id = v_team_id
        and tm.athlete_id = v_athlete_id
    );

    insert into public.team_athletes (team_id, athlete_id, status)
    values (v_team_id, v_athlete_id, 'active')
    on conflict do nothing;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'join_codes'
      and c.column_name = 'uses_count'
  ) into v_has_uses_count;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'join_codes'
      and c.column_name = 'used_count'
  ) into v_has_used_count;

  if v_has_uses_count then
    update public.join_codes as jc
    set uses_count = coalesce(jc.uses_count, 0) + 1
    where jc.code::text = p_code;
  end if;

  if v_has_used_count then
    update public.join_codes as jc
    set used_count = coalesce(jc.used_count, 0) + 1
    where jc.code::text = p_code;
  end if;

  return query select v_org_id, v_team_id, v_athlete_id, v_profile_id;
end;
$$;
ALTER FUNCTION "public"."signup_register_athlete_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_graduation_year" integer, "p_cell_number" "text", "p_positions" "uuid"[], "p_terms_accepted" boolean) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."signup_register_coach_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) RETURNS TABLE("org_id" "uuid", "team_id" "uuid", "coach_id" "uuid", "profile_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_profile_id uuid;
  v_coach_id uuid;
  v_org_id uuid;
  v_team_id uuid;
  v_has_uses_count boolean := false;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode='P0001';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'FIRST_NAME_REQUIRED' using errcode='P0001';
  end if;
  if p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'LAST_NAME_REQUIRED' using errcode='P0001';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'EMAIL_REQUIRED' using errcode='P0001';
  end if;
  if not p_terms_accepted then
    raise exception 'TERMS_REQUIRED' using errcode='P0001';
  end if;

  select jc.org_id, jc.team_id
    into v_org_id, v_team_id
  from public.join_codes as jc
  where jc.code::text = p_code
    and coalesce(jc.disabled, false) = false
    and coalesce(jc.is_active, true) = true
    and (jc.expires_at is null or jc.expires_at > now())
    and (
      jc.max_uses is null
      or coalesce(jc.uses_count, jc.used_count, 0) < jc.max_uses
    )
  for update;

  if not found then
    raise exception 'INVALID_JOIN_CODE' using errcode='P0001';
  end if;

  insert into public.profiles as pr (
    id,
    user_id,
    first_name,
    last_name,
    full_name,
    default_org_id,
    email,
    phone,
    role,
    terms_accepted,
    terms_accepted_at
  )
  values (
    p_user_id,
    p_user_id,
    btrim(p_first_name),
    btrim(p_last_name),
    btrim(p_first_name || ' ' || p_last_name),
    v_org_id,
    lower(p_email),
    nullif(btrim(p_cell_number), ''),
    'coach',
    p_terms_accepted,
    case when p_terms_accepted then now() else null end
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        default_org_id = excluded.default_org_id,
        email = excluded.email,
        phone = excluded.phone,
        role = 'coach',
        user_id = excluded.user_id,
        terms_accepted = excluded.terms_accepted,
        terms_accepted_at = excluded.terms_accepted_at
  returning pr.id into v_profile_id;

  update public.org_memberships om
  set role = 'coach',
      is_active = true
  where om.org_id = v_org_id
    and om.user_id = p_user_id;

  if not found then
    insert into public.org_memberships (org_id, user_id, role, is_active)
    values (v_org_id, p_user_id, 'coach', true);
  end if;

  select c.id
    into v_coach_id
  from public.coaches as c
  where c.org_id = v_org_id
    and c.user_id = p_user_id
  limit 1;

  if v_coach_id is null then
    insert into public.coaches as c (
      org_id,
      user_id,
      full_name,
      email,
      phone,
      cell_number
    )
    values (
      v_org_id,
      p_user_id,
      btrim(p_first_name || ' ' || p_last_name),
      lower(p_email),
      nullif(btrim(p_cell_number), ''),
      nullif(btrim(p_cell_number), '')
    )
    returning c.id into v_coach_id;
  else
    update public.coaches as c
      set full_name = btrim(p_first_name || ' ' || p_last_name),
          email = lower(p_email),
          phone = nullif(btrim(p_cell_number), ''),
          cell_number = nullif(btrim(p_cell_number), '')
    where c.id = v_coach_id;
  end if;

  if v_team_id is not null then
    insert into public.team_memberships (team_id, coach_id, created_at)
    select v_team_id, v_coach_id, now()
    where not exists (
      select 1
      from public.team_memberships tm
      where tm.team_id = v_team_id
        and tm.coach_id = v_coach_id
    );
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'join_codes'
      and c.column_name = 'uses_count'
  ) into v_has_uses_count;

  if v_has_uses_count then
    update public.join_codes as jc
    set uses_count = coalesce(jc.uses_count, 0) + 1
    where jc.code::text = p_code;
  end if;

  update public.join_codes as jc
  set used_count = coalesce(jc.used_count, 0) + 1
  where jc.code::text = p_code;

  return query select v_org_id, v_team_id, v_coach_id, v_profile_id;
end;
$$;
ALTER FUNCTION "public"."signup_register_coach_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."signup_register_org_tx"("p_user_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_phone" "text", "p_org_name" "text", "p_program_gender" "text", "p_team_names" "text"[], "p_sport_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("org_id" "uuid", "profile_id" "uuid", "team_ids" "uuid"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
  v_team_ids uuid[] := '{}';
  v_base text;
  v_slug text;
  v_i integer := 2;
  v_full_name text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'Organization name is required';
  end if;
  if p_program_gender not in ('girls','boys','coed') then
    raise exception 'program_gender must be one of girls|boys|coed';
  end if;

  v_base := public.slugify(p_org_name);
  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_slug := v_base || '-' || v_i;
    v_i := v_i + 1;
  end loop;

  insert into public.organizations(name, program_gender, slug, sport_id)
  values (trim(p_org_name), p_program_gender, v_slug, p_sport_id)
  returning id into v_org_id;

  v_full_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');

  insert into public.profiles (
    id,
    user_id,
    full_name,
    default_org_id,
    phone,
    first_name,
    last_name,
    email,
    role
  )
  values (
    p_user_id,
    p_user_id,
    v_full_name,
    v_org_id,
    nullif(trim(p_phone), ''),
    nullif(trim(p_first_name), ''),
    nullif(trim(p_last_name), ''),
    nullif(trim(p_email), ''),
    'admin'
  )
  on conflict (id) do update
    set
      full_name = excluded.full_name,
      default_org_id = excluded.default_org_id,
      phone = excluded.phone,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = excluded.email,
      role = excluded.role;

  update public.org_memberships om
  set role = 'admin',
      is_active = true
  where om.org_id = v_org_id
    and om.user_id = p_user_id;

  if not found then
    insert into public.org_memberships (org_id, user_id, role, is_active)
    values (v_org_id, p_user_id, 'admin', true);
  end if;

  profile_id := p_user_id;

  if p_team_names is not null then
    with cleaned as (
      select distinct on (trim(t)) trim(t) as team_name
      from unnest(p_team_names) as t
      where coalesce(trim(t), '') <> ''
    ), ins as (
      insert into public.teams (org_id, name)
      select v_org_id, c.team_name from cleaned c
      returning id
    )
    select coalesce(array_agg(ins.id), '{}') into v_team_ids from ins;
  end if;

  org_id := v_org_id;
  team_ids := v_team_ids;
  return next;
end;
$$;
ALTER FUNCTION "public"."signup_register_org_tx"("p_user_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_phone" "text", "p_org_name" "text", "p_program_gender" "text", "p_team_names" "text"[], "p_sport_id" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."signup_register_parent_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) RETURNS TABLE("org_id" "uuid", "team_id" "uuid", "guardian_id" "uuid", "profile_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
  v_team_id uuid;
  v_guardian_id uuid;
  v_full_name text;
begin
  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'FIRST_NAME_REQUIRED' using errcode='P0001';
  end if;
  if p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'LAST_NAME_REQUIRED' using errcode='P0001';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'EMAIL_REQUIRED' using errcode='P0001';
  end if;
  if not p_terms_accepted then
    raise exception 'TERMS_REQUIRED' using errcode='P0001';
  end if;

  select jc.org_id, jc.team_id
    into v_org_id, v_team_id
  from public.join_codes as jc
  where jc.code::text = p_code
    and coalesce(jc.is_active, true)
    and not coalesce(jc.disabled, false)
    and (jc.expires_at is null or jc.expires_at > now())
  for update;

  if not found then
    raise exception 'INVALID_JOIN_CODE' using errcode='P0001';
  end if;

  v_full_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');

  insert into public.profiles (
    id,
    user_id,
    first_name,
    last_name,
    full_name,
    default_org_id,
    email,
    phone,
    role,
    terms_accepted,
    terms_accepted_at
  )
  values (
    p_user_id,
    p_user_id,
    btrim(p_first_name),
    btrim(p_last_name),
    v_full_name,
    v_org_id,
    lower(p_email),
    nullif(btrim(p_cell_number), ''),
    'parent',
    p_terms_accepted,
    case when p_terms_accepted then now() else null end
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        default_org_id = excluded.default_org_id,
        email = excluded.email,
        phone = excluded.phone,
        role = 'parent',
        user_id = excluded.user_id,
        terms_accepted = excluded.terms_accepted,
        terms_accepted_at = excluded.terms_accepted_at;

  insert into public.org_memberships (org_id, user_id, role, is_active)
  values (v_org_id, p_user_id, 'parent', true)
  on conflict (org_id, user_id) do update
    set role = excluded.role,
        is_active = true;

  insert into public.guardian_contacts (
    org_id,
    user_id,
    full_name,
    email,
    phone
  )
  values (
    v_org_id,
    p_user_id,
    v_full_name,
    lower(p_email),
    nullif(btrim(p_cell_number), '')
  )
  on conflict do nothing;

  select id
    into v_guardian_id
  from public.guardian_contacts
  where org_id = v_org_id
    and user_id = p_user_id
  limit 1;

  update public.join_codes
  set uses_count = coalesce(uses_count, 0) + 1,
      used_count = coalesce(used_count, 0) + 1
  where code = p_code;

  return query select v_org_id, v_team_id, v_guardian_id, p_user_id;
end;
$$;
ALTER FUNCTION "public"."signup_register_parent_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."slugify"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;
ALTER FUNCTION "public"."slugify"("value" "text") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."submit_evaluation_tx"("p_evaluation_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("id" "uuid", "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_status text;
begin
  perform 1
  from public.evaluations as evals
  where evals.id = p_evaluation_id
    and evals.org_id = p_org_id;

  if not found then
    raise exception 'Evaluation not found';
  end if;

  update public.evaluations as evals
  set status = 'completed'
  where evals.id = p_evaluation_id
    and evals.org_id = p_org_id
    and evals.status in ('not_started', 'in_progress')
  returning evals.status into v_status;

  if v_status is null then
    select evals.status
      into v_status
    from public.evaluations as evals
    where evals.id = p_evaluation_id
      and evals.org_id = p_org_id
    limit 1;
  end if;

  insert into public.evaluation_workout_progress (
    org_id,
    evaluation_id,
    athlete_id,
    progress,
    level,
    created_at,
    updated_at
  )
  select
    items.org_id,
    items.evaluation_id,
    items.athlete_id,
    0 as progress,
    1 as level,
    now() as created_at,
    now() as updated_at
  from (
    select
      evals.org_id,
      evals.id as evaluation_id,
      eval_items.athlete_id
    from public.evaluation_items eval_items
    inner join public.evaluations evals
      on eval_items.evaluation_id = evals.id
    where eval_items.evaluation_id = p_evaluation_id
      and evals.org_id = p_org_id
    group by evals.org_id, evals.id, eval_items.athlete_id
  ) as items
  on conflict (org_id, evaluation_id, athlete_id) do nothing;

  insert into public.evaluation_workout_drills (
    org_id,
    evaluation_id,
    athlete_id,
    skill_id,
    drill_id,
    rate,
    level,
    created_at,
    updated_at
  )
  select
    evals.org_id,
    evals.id as evaluation_id,
    items.athlete_id,
    drills.skill_id,
    drills.drill_id,
    items.rating,
    drills.level,
    now() as created_at,
    now() as updated_at
  from public.evaluations evals
  inner join public.evaluation_items items
    on evals.id = items.evaluation_id
  inner join public.skill_drill_map drills
    on items.subskill_id = drills.skill_id
  where evals.id = p_evaluation_id
    and evals.org_id = p_org_id
    and items.rating < 3
    and drills.level is not null
  order by items.athlete_id, drills.skill_id, drills.level;

  return query select p_evaluation_id as id, v_status as status;
end;
$$;
ALTER FUNCTION "public"."submit_evaluation_tx"("p_evaluation_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."athlete_evaluation_result_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "result_id" "uuid",
    "org_id" "uuid",
    "skill_id" "uuid",
    "rating" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."athlete_evaluation_result_items" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."athlete_evaluation_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "evaluation_id" "uuid",
    "org_id" "uuid",
    "athlete_id" "uuid",
    "scorecard_template_id" "uuid",
    "coach_id" "uuid",
    "evaluated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."athlete_evaluation_results" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."athlete_guardians" (
    "athlete_id" "uuid" NOT NULL,
    "guardian_id" "uuid" NOT NULL,
    "relationship" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."athlete_guardians" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."athlete_positions" (
    "athlete_id" "uuid" NOT NULL,
    "position" "text",
    "position_id" "uuid" NOT NULL
);
ALTER TABLE "public"."athlete_positions" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."athlete_positionsbk" (
    "athlete_id" "uuid",
    "position" "text",
    "position_id" "uuid"
);
ALTER TABLE "public"."athlete_positionsbk" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."athletes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "sport_id" "uuid",
    "primary_position_id" "uuid",
    "jersey_number" "text",
    "dominant_hand" "text",
    "height_cm" integer,
    "weight_kg" integer,
    "graduation_year" integer,
    "school" "text",
    "birthdate" "date",
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cell_number" "text",
    "first_name" "text",
    "last_name" "text",
    "full_name" "text",
    "phone" "text",
    "email" "text",
    "gender" "text"
);
ALTER TABLE "public"."athletes" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."coaches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "sport_id" "uuid",
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "title" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cell_number" "text"
);
ALTER TABLE "public"."coaches" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "drill_id" "uuid" NOT NULL,
    "media_type" "text" DEFAULT 'video'::"text" NOT NULL,
    "title" "text",
    "url" "text" NOT NULL,
    "storage_path" "text",
    "thumbnail_url" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."drill_media" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_media_import" (
    "drill_name" "text",
    "youtube_url" "text",
    "title" "text",
    "sort_order" integer
);
ALTER TABLE "public"."drill_media_import" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_skills" (
    "drill_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL
);
ALTER TABLE "public"."drill_skills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "drill_id" "uuid" NOT NULL,
    "position" integer,
    "title" "text",
    "instruction" "text",
    "duration_sec" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."drill_steps" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_subskills" (
    "drill_id" "uuid" NOT NULL,
    "subskill_id" "uuid" NOT NULL,
    "weight" numeric
);
ALTER TABLE "public"."drill_subskills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_tag_map" (
    "drill_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);
ALTER TABLE "public"."drill_tag_map" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_tag_map_bk" (
    "drill_id" "uuid",
    "tag_id" "uuid"
);
ALTER TABLE "public"."drill_tag_map_bk" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_tag_map_bk2" (
    "drill_id" "uuid",
    "tag_id" "uuid"
);
ALTER TABLE "public"."drill_tag_map_bk2" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drill_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."drill_tags" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "segment_id" "uuid",
    "sport_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "objective" "text",
    "coaching_points" "text",
    "min_players" integer,
    "max_players" integer,
    "duration_min" integer,
    "level" "text",
    "visibility" "text" DEFAULT 'private'::"text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "search_tsv" "tsvector",
    "min_age" integer,
    "max_age" integer
);
ALTER TABLE "public"."drills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."drillsbk07abr2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "segment_id" "uuid",
    "sport_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "objective" "text",
    "coaching_points" "text",
    "min_players" integer,
    "max_players" integer,
    "duration_min" integer,
    "level" "text",
    "visibility" "text" DEFAULT 'private'::"text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "search_tsv" "tsvector",
    "min_age" integer,
    "max_age" integer
);
ALTER TABLE "public"."drillsbk07abr2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "subskill_id" "uuid" NOT NULL,
    "rating" numeric,
    "comment" "text",
    "recommended_skill_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_items" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_itemsbk27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "subskill_id" "uuid" NOT NULL,
    "rating" numeric,
    "comment" "text",
    "recommended_skill_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_itemsbk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_drills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "skill_id" "uuid",
    "drill_id" "uuid",
    "rate" numeric,
    "level" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_drills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_drills_bk" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "skill_id" "uuid",
    "drill_id" "uuid",
    "rate" numeric,
    "level" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_drills_bk" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_drillsbk27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "skill_id" "uuid",
    "drill_id" "uuid",
    "rate" numeric,
    "level" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_drillsbk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "progress" integer DEFAULT 0,
    "level" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_progress" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_progress_bk" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "progress" integer DEFAULT 0,
    "level" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_progress_bk" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluation_workout_progressbk27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "evaluation_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "progress" integer DEFAULT 0,
    "level" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."evaluation_workout_progressbk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "template_id" "uuid",
    "teams_id" "uuid",
    "coach_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL
);
ALTER TABLE "public"."evaluations" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."evaluationsbk27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "template_id" "uuid",
    "teams_id" "uuid",
    "coach_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL
);
ALTER TABLE "public"."evaluationsbk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."guardian_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "region" "text",
    "postal_code" "text",
    "country" "text",
    "is_verified" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."guardian_contacts" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."join_codes" (
    "code" "text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "team_id" "uuid",
    "max_uses" integer DEFAULT 1 NOT NULL,
    "used_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uses_count" integer DEFAULT 0 NOT NULL,
    "disabled" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."join_codes" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "evaluation_id" "uuid",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);
ALTER TABLE "public"."notifications" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."org_branding" (
    "org_id" "uuid" NOT NULL,
    "logo_url" "text",
    "primary_color" "text",
    "secondary_color" "text",
    "custom_domain" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."org_branding" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."org_members" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."org_memberships" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "org_memberships_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'coach'::"text", 'athlete'::"text", 'parent'::"text", 'staff'::"text", 'viewer'::"text"])))
);
ALTER TABLE "public"."org_memberships" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sport_mode" "text",
    "program_gender" "text" DEFAULT 'coed'::"text" NOT NULL,
    "maxBelowThresholdRatingsAllowed" integer,
    "maxWorkoutReps" integer,
    "sport_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organizations_program_gender_check" CHECK (("program_gender" = ANY (ARRAY['girls'::"text", 'boys'::"text", 'coed'::"text"])))
);
ALTER TABLE "public"."organizations" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sport_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."positions" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."practice_plan_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid",
    "org_id" "uuid",
    "team_id" "uuid",
    "athlete_id" "uuid",
    "assigned_by" "uuid",
    "scheduled_for" timestamp with time zone,
    "status" "text",
    "notes" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."practice_plan_assignments" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."practice_plan_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "invited_user_id" "uuid",
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'hex'::"text") NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone
);
ALTER TABLE "public"."practice_plan_invitations" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."practice_plan_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "section_title" "text",
    "section_order" integer,
    "position" integer,
    "item_type" "text" DEFAULT 'drill'::"text" NOT NULL,
    "drill_id" "uuid",
    "title" "text",
    "instructions" "text",
    "sets" integer,
    "reps" integer,
    "duration_seconds" integer,
    "rest_seconds" integer,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_min" integer
);
ALTER TABLE "public"."practice_plan_items" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."practice_plan_members" (
    "plan_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."practice_plan_members" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."practice_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "owner_user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "estimated_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text" DEFAULT 'custom'::"text" NOT NULL
);
ALTER TABLE "public"."practice_plans" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "default_org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone" "text",
    "terms_accepted" boolean DEFAULT false,
    "terms_accepted_at" timestamp with time zone,
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "role" "text",
    "user_id" "uuid"
);
ALTER TABLE "public"."profiles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."recommendation_rules" (
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid" NOT NULL,
    "threshold" numeric DEFAULT 3 NOT NULL
);
ALTER TABLE "public"."recommendation_rules" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."roles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."scorecard_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."scorecard_categories" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."scorecard_subskills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "position" integer DEFAULT 0 NOT NULL,
    "rating_min" integer DEFAULT 1,
    "rating_max" integer DEFAULT 5,
    "skill_id" "uuid",
    "priority" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."scorecard_subskills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."scorecard_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."scorecard_templates" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "position" integer,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."segments" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_drill_map" (
    "skill_id" "uuid" NOT NULL,
    "drill_id" "uuid" NOT NULL,
    "level" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" NOT NULL
);
ALTER TABLE "public"."skill_drill_map" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_drill_mapbk27mar2026" (
    "skill_id" "uuid" NOT NULL,
    "drill_id" "uuid" NOT NULL,
    "level" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skill_drill_mapbk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "media_type" "text" DEFAULT 'video'::"text" NOT NULL,
    "title" "text",
    "url" "text" NOT NULL,
    "storage_path" "text",
    "thumbnail_url" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skill_media" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_mediabk27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "media_type" "text" DEFAULT 'video'::"text" NOT NULL,
    "title" "text",
    "url" "text" NOT NULL,
    "storage_path" "text",
    "thumbnail_url" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skill_mediabk27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_positions" (
    "skill_id" "uuid" NOT NULL,
    "position_id" "uuid" NOT NULL
);
ALTER TABLE "public"."skill_positions" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_tags" (
    "skill_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);
ALTER TABLE "public"."skill_tags" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_tags27mar2026" (
    "skill_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);
ALTER TABLE "public"."skill_tags27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skill_video_map" (
    "skill_id" "uuid" NOT NULL,
    "bucket" "text" NOT NULL,
    "object_path" "text" NOT NULL,
    "title" "text",
    "description" "text",
    "thumbnail_url" "text",
    "position" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skill_video_map" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "category" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "level" "text",
    "coaching_points" "text",
    "visibility" "text" DEFAULT 'private'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skills" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skills27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "category" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "level" "text",
    "coaching_points" "text",
    "visibility" "text" DEFAULT 'private'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skills27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."skills_27mar2026" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "category" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "level" "text",
    "coaching_points" "text",
    "visibility" "text" DEFAULT 'private'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."skills_27mar2026" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."sports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."sports" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."subskill_skill_links" (
    "subskill_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "priority" integer
);
ALTER TABLE "public"."subskill_skill_links" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL
);
ALTER TABLE "public"."tags" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."team_athletes" (
    "team_id" "uuid" NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."team_athletes" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."team_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "athlete_id" "uuid",
    "coach_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."team_memberships" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "sport_id" "uuid",
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "coach_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."teams" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."users" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."video_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "sport_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "storage_bucket" "text",
    "storage_path" "text",
    "duration_sec" integer,
    "visibility" "text",
    "status" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."video_assets" OWNER TO "postgres";
ALTER TABLE ONLY "public"."athlete_evaluation_result_items"
    ADD CONSTRAINT "athlete_evaluation_result_items_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."athlete_guardians"
    ADD CONSTRAINT "athlete_guardians_pkey" PRIMARY KEY ("athlete_id", "guardian_id");
ALTER TABLE ONLY "public"."athlete_positions"
    ADD CONSTRAINT "athlete_positions_pkey" PRIMARY KEY ("athlete_id", "position_id");
ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."drill_media"
    ADD CONSTRAINT "drill_media_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."drill_skills"
    ADD CONSTRAINT "drill_skills_pkey" PRIMARY KEY ("drill_id", "skill_id");
ALTER TABLE ONLY "public"."drill_steps"
    ADD CONSTRAINT "drill_steps_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."drill_subskills"
    ADD CONSTRAINT "drill_subskills_pkey" PRIMARY KEY ("drill_id", "subskill_id");
ALTER TABLE ONLY "public"."drill_tag_map"
    ADD CONSTRAINT "drill_tag_map_pkey" PRIMARY KEY ("drill_id", "tag_id");
ALTER TABLE ONLY "public"."drill_tags"
    ADD CONSTRAINT "drill_tags_org_id_name_key" UNIQUE ("org_id", "name");
ALTER TABLE ONLY "public"."drill_tags"
    ADD CONSTRAINT "drill_tags_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."drills"
    ADD CONSTRAINT "drills_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."evaluation_items"
    ADD CONSTRAINT "evaluation_items_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."evaluation_workout_drills"
    ADD CONSTRAINT "evaluation_workout_drills_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."evaluation_workout_progress"
    ADD CONSTRAINT "evaluation_workout_progress_org_id_evaluation_id_athlete_id_key" UNIQUE ("org_id", "evaluation_id", "athlete_id");
ALTER TABLE ONLY "public"."evaluation_workout_progress"
    ADD CONSTRAINT "evaluation_workout_progress_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."guardian_contacts"
    ADD CONSTRAINT "guardian_contacts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."join_codes"
    ADD CONSTRAINT "join_codes_pkey" PRIMARY KEY ("code");
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."org_branding"
    ADD CONSTRAINT "org_branding_pkey" PRIMARY KEY ("org_id");
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id", "user_id");
ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("org_id", "user_id");
ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_sport_id_code_key" UNIQUE ("sport_id", "code");
ALTER TABLE ONLY "public"."practice_plan_assignments"
    ADD CONSTRAINT "practice_plan_assignments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."practice_plan_invitations"
    ADD CONSTRAINT "practice_plan_invitations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."practice_plan_items"
    ADD CONSTRAINT "practice_plan_items_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."practice_plan_members"
    ADD CONSTRAINT "practice_plan_members_pkey" PRIMARY KEY ("plan_id", "user_id");
ALTER TABLE ONLY "public"."practice_plans"
    ADD CONSTRAINT "practice_plans_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."recommendation_rules"
    ADD CONSTRAINT "recommendation_rules_pkey" PRIMARY KEY ("org_id", "sport_id");
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_code_key" UNIQUE ("code");
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."scorecard_categories"
    ADD CONSTRAINT "scorecard_categories_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."scorecard_subskills"
    ADD CONSTRAINT "scorecard_subskills_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."scorecard_templates"
    ADD CONSTRAINT "scorecard_templates_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."skill_drill_map"
    ADD CONSTRAINT "skill_drill_map_pkey" PRIMARY KEY ("skill_id", "drill_id");
ALTER TABLE ONLY "public"."skill_media"
    ADD CONSTRAINT "skill_media_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."skill_positions"
    ADD CONSTRAINT "skill_positions_pkey" PRIMARY KEY ("skill_id", "position_id");
ALTER TABLE ONLY "public"."skill_tags"
    ADD CONSTRAINT "skill_tags_pkey" PRIMARY KEY ("skill_id", "tag_id");
ALTER TABLE ONLY "public"."skill_video_map"
    ADD CONSTRAINT "skill_video_map_pkey" PRIMARY KEY ("skill_id", "bucket", "object_path");
ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."sports"
    ADD CONSTRAINT "sports_code_key" UNIQUE ("code");
ALTER TABLE ONLY "public"."sports"
    ADD CONSTRAINT "sports_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."subskill_skill_links"
    ADD CONSTRAINT "subskill_skill_links_pkey" PRIMARY KEY ("subskill_id", "skill_id");
ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."team_athletes"
    ADD CONSTRAINT "team_athletes_pkey" PRIMARY KEY ("team_id", "athlete_id");
ALTER TABLE ONLY "public"."team_memberships"
    ADD CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."video_assets"
    ADD CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id");
CREATE INDEX "idx_athletes_org_id" ON "public"."athletes" USING "btree" ("org_id");
CREATE INDEX "idx_athletes_user_id" ON "public"."athletes" USING "btree" ("user_id");
CREATE INDEX "idx_coaches_org_id" ON "public"."coaches" USING "btree" ("org_id");
CREATE INDEX "idx_coaches_user_id" ON "public"."coaches" USING "btree" ("user_id");
CREATE INDEX "idx_drills_org_id" ON "public"."drills" USING "btree" ("org_id");
CREATE INDEX "idx_evaluation_items_evaluation_id" ON "public"."evaluation_items" USING "btree" ("evaluation_id");
CREATE INDEX "idx_evaluations_org_id" ON "public"."evaluations" USING "btree" ("org_id");
CREATE INDEX "idx_guardian_contacts_org_id" ON "public"."guardian_contacts" USING "btree" ("org_id");
CREATE INDEX "idx_practice_plans_org_id" ON "public"."practice_plans" USING "btree" ("org_id");
CREATE INDEX "idx_profiles_user_id" ON "public"."profiles" USING "btree" ("user_id");
CREATE INDEX "idx_skills_org_id" ON "public"."skills" USING "btree" ("org_id");
CREATE INDEX "idx_teams_org_id" ON "public"."teams" USING "btree" ("org_id");
CREATE UNIQUE INDEX "profiles_user_id_unique" ON "public"."profiles" USING "btree" ("user_id");
CREATE OR REPLACE TRIGGER "set_athletes_updated_at" BEFORE UPDATE ON "public"."athletes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_coaches_updated_at" BEFORE UPDATE ON "public"."coaches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_drills_updated_at" BEFORE UPDATE ON "public"."drills" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_guardian_contacts_updated_at" BEFORE UPDATE ON "public"."guardian_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_positions_updated_at" BEFORE UPDATE ON "public"."positions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_practice_plans_updated_at" BEFORE UPDATE ON "public"."practice_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_scorecard_templates_updated_at" BEFORE UPDATE ON "public"."scorecard_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_skills_updated_at" BEFORE UPDATE ON "public"."skills" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_sports_updated_at" BEFORE UPDATE ON "public"."sports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE OR REPLACE TRIGGER "set_teams_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
ALTER TABLE ONLY "public"."athlete_evaluation_result_items"
    ADD CONSTRAINT "athlete_evaluation_result_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_evaluation_result_items"
    ADD CONSTRAINT "athlete_evaluation_result_items_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "public"."athlete_evaluation_results"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_evaluation_result_items"
    ADD CONSTRAINT "athlete_evaluation_result_items_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_evaluation_results"
    ADD CONSTRAINT "athlete_evaluation_results_scorecard_template_id_fkey" FOREIGN KEY ("scorecard_template_id") REFERENCES "public"."scorecard_templates"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."athlete_guardians"
    ADD CONSTRAINT "athlete_guardians_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_guardians"
    ADD CONSTRAINT "athlete_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian_contacts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athlete_positions"
    ADD CONSTRAINT "athlete_positions_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_primary_position_id_fkey" FOREIGN KEY ("primary_position_id") REFERENCES "public"."positions"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "public"."drill_media"
    ADD CONSTRAINT "drill_media_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_skills"
    ADD CONSTRAINT "drill_skills_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_skills"
    ADD CONSTRAINT "drill_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_steps"
    ADD CONSTRAINT "drill_steps_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_subskills"
    ADD CONSTRAINT "drill_subskills_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_subskills"
    ADD CONSTRAINT "drill_subskills_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "public"."scorecard_subskills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_tag_map"
    ADD CONSTRAINT "drill_tag_map_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_tag_map"
    ADD CONSTRAINT "drill_tag_map_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."drill_tags"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_tags"
    ADD CONSTRAINT "drill_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drill_tags"
    ADD CONSTRAINT "drill_tags_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."drills"
    ADD CONSTRAINT "drills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."drills"
    ADD CONSTRAINT "drills_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."drills"
    ADD CONSTRAINT "drills_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."evaluation_items"
    ADD CONSTRAINT "evaluation_items_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_items"
    ADD CONSTRAINT "evaluation_items_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_items"
    ADD CONSTRAINT "evaluation_items_recommended_skill_id_fkey" FOREIGN KEY ("recommended_skill_id") REFERENCES "public"."skills"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."evaluation_items"
    ADD CONSTRAINT "evaluation_items_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_drills"
    ADD CONSTRAINT "evaluation_workout_drills_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_drills"
    ADD CONSTRAINT "evaluation_workout_drills_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_drills"
    ADD CONSTRAINT "evaluation_workout_drills_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_drills"
    ADD CONSTRAINT "evaluation_workout_drills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_progress"
    ADD CONSTRAINT "evaluation_workout_progress_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_progress"
    ADD CONSTRAINT "evaluation_workout_progress_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluation_workout_progress"
    ADD CONSTRAINT "evaluation_workout_progress_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_teams_id_fkey" FOREIGN KEY ("teams_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."evaluations"
    ADD CONSTRAINT "evaluations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."scorecard_templates"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."guardian_contacts"
    ADD CONSTRAINT "guardian_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."join_codes"
    ADD CONSTRAINT "join_codes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."join_codes"
    ADD CONSTRAINT "join_codes_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."org_branding"
    ADD CONSTRAINT "org_branding_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_assignments"
    ADD CONSTRAINT "practice_plan_assignments_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_assignments"
    ADD CONSTRAINT "practice_plan_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_assignments"
    ADD CONSTRAINT "practice_plan_assignments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."practice_plans"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_assignments"
    ADD CONSTRAINT "practice_plan_assignments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_invitations"
    ADD CONSTRAINT "practice_plan_invitations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."practice_plans"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_items"
    ADD CONSTRAINT "practice_plan_items_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."practice_plan_items"
    ADD CONSTRAINT "practice_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."practice_plans"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plan_members"
    ADD CONSTRAINT "practice_plan_members_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."practice_plans"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."practice_plans"
    ADD CONSTRAINT "practice_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_default_org_id_fkey" FOREIGN KEY ("default_org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."recommendation_rules"
    ADD CONSTRAINT "recommendation_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recommendation_rules"
    ADD CONSTRAINT "recommendation_rules_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scorecard_categories"
    ADD CONSTRAINT "scorecard_categories_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."scorecard_templates"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scorecard_subskills"
    ADD CONSTRAINT "scorecard_subskills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."scorecard_categories"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scorecard_subskills"
    ADD CONSTRAINT "scorecard_subskills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."scorecard_templates"
    ADD CONSTRAINT "scorecard_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scorecard_templates"
    ADD CONSTRAINT "scorecard_templates_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_drill_map"
    ADD CONSTRAINT "skill_drill_map_drill_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "public"."drills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_drill_map"
    ADD CONSTRAINT "skill_drill_map_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_drill_map"
    ADD CONSTRAINT "skill_drill_map_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_media"
    ADD CONSTRAINT "skill_media_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_positions"
    ADD CONSTRAINT "skill_positions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_positions"
    ADD CONSTRAINT "skill_positions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_tags"
    ADD CONSTRAINT "skill_tags_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_tags"
    ADD CONSTRAINT "skill_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skill_video_map"
    ADD CONSTRAINT "skill_video_map_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."subskill_skill_links"
    ADD CONSTRAINT "subskill_skill_links_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."subskill_skill_links"
    ADD CONSTRAINT "subskill_skill_links_subskill_id_fkey" FOREIGN KEY ("subskill_id") REFERENCES "public"."scorecard_subskills"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_athletes"
    ADD CONSTRAINT "team_athletes_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_athletes"
    ADD CONSTRAINT "team_athletes_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_memberships"
    ADD CONSTRAINT "team_memberships_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_memberships"
    ADD CONSTRAINT "team_memberships_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_memberships"
    ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");
ALTER TABLE ONLY "public"."video_assets"
    ADD CONSTRAINT "video_assets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."video_assets"
    ADD CONSTRAINT "video_assets_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id");
ALTER TABLE "public"."athlete_evaluation_result_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."athlete_evaluation_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."athlete_guardians" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."athlete_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."athlete_positionsbk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."athletes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."coaches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_media_import" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_subskills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_tag_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_tag_map_bk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_tag_map_bk2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drill_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drillsbk07abr2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_itemsbk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_drills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_drills_bk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_drillsbk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_progress_bk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluation_workout_progressbk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."evaluationsbk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."guardian_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."join_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."org_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."org_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."org_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_plan_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_plan_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_plan_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."recommendation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scorecard_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scorecard_subskills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scorecard_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_drill_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_drill_mapbk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_mediabk27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_tags27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skill_video_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skills27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."skills_27mar2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."subskill_skill_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."team_athletes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."team_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."video_assets" ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON FUNCTION "public"."create_athlete_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_team_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text", "p_gender" "text", "p_guardian_id" "uuid", "p_guardian_user_id" "uuid", "p_guardian_full_name" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_guardian_relationship" "text", "p_graduation_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_athlete_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_team_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text", "p_gender" "text", "p_guardian_id" "uuid", "p_guardian_user_id" "uuid", "p_guardian_full_name" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_guardian_relationship" "text", "p_graduation_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_athlete_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_team_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text", "p_gender" "text", "p_guardian_id" "uuid", "p_guardian_user_id" "uuid", "p_guardian_full_name" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_guardian_relationship" "text", "p_graduation_year" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_coach_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_coach_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_coach_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_cell_number" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_guardian_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_athlete_ids" "uuid"[], "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_address_line1" "text", "p_address_line2" "text", "p_city" "text", "p_region" "text", "p_postal_code" "text", "p_country" "text", "p_relationship" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_guardian_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_athlete_ids" "uuid"[], "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_address_line1" "text", "p_address_line2" "text", "p_city" "text", "p_region" "text", "p_postal_code" "text", "p_country" "text", "p_relationship" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_guardian_tx"("p_user_id" "uuid", "p_org_id" "uuid", "p_athlete_ids" "uuid"[], "p_full_name" "text", "p_email" "text", "p_phone" "text", "p_address_line1" "text", "p_address_line2" "text", "p_city" "text", "p_region" "text", "p_postal_code" "text", "p_country" "text", "p_relationship" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_scorecard_template_tx"("p_template" "jsonb", "p_created_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_scorecard_template_tx"("p_template" "jsonb", "p_created_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_scorecard_template_tx"("p_template" "jsonb", "p_created_by" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."evaluations_bulk_create_tx"("evaluations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."evaluations_bulk_create_tx"("evaluations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluations_bulk_create_tx"("evaluations" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."list_evaluation_skill_videos"("p_evaluation_id" "uuid", "p_org_id" "uuid", "p_athlete_id" "uuid", "p_rating_max" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."list_evaluation_skill_videos"("p_evaluation_id" "uuid", "p_org_id" "uuid", "p_athlete_id" "uuid", "p_rating_max" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_evaluation_skill_videos"("p_evaluation_id" "uuid", "p_org_id" "uuid", "p_athlete_id" "uuid", "p_rating_max" numeric) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_create_drill"("p_drill" "jsonb", "p_media" "jsonb", "p_skill_tags" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_drill"("p_drill" "jsonb", "p_media" "jsonb", "p_skill_tags" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_drill"("p_drill" "jsonb", "p_media" "jsonb", "p_skill_tags" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."signup_register_athlete_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_graduation_year" integer, "p_cell_number" "text", "p_positions" "uuid"[], "p_terms_accepted" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."signup_register_athlete_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_graduation_year" integer, "p_cell_number" "text", "p_positions" "uuid"[], "p_terms_accepted" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."signup_register_athlete_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_graduation_year" integer, "p_cell_number" "text", "p_positions" "uuid"[], "p_terms_accepted" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."signup_register_coach_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."signup_register_coach_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."signup_register_coach_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."signup_register_org_tx"("p_user_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_phone" "text", "p_org_name" "text", "p_program_gender" "text", "p_team_names" "text"[], "p_sport_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."signup_register_org_tx"("p_user_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_phone" "text", "p_org_name" "text", "p_program_gender" "text", "p_team_names" "text"[], "p_sport_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."signup_register_org_tx"("p_user_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_phone" "text", "p_org_name" "text", "p_program_gender" "text", "p_team_names" "text"[], "p_sport_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."signup_register_parent_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."signup_register_parent_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."signup_register_parent_with_code_tx"("p_user_id" "uuid", "p_code" "text", "p_first_name" "text", "p_last_name" "text", "p_email" "text", "p_cell_number" "text", "p_terms_accepted" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."slugify"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."slugify"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."slugify"("value" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."submit_evaluation_tx"("p_evaluation_id" "uuid", "p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_evaluation_tx"("p_evaluation_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_evaluation_tx"("p_evaluation_id" "uuid", "p_org_id" "uuid") TO "service_role";
GRANT ALL ON TABLE "public"."athlete_evaluation_result_items" TO "anon";
GRANT ALL ON TABLE "public"."athlete_evaluation_result_items" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_evaluation_result_items" TO "service_role";
GRANT ALL ON TABLE "public"."athlete_evaluation_results" TO "anon";
GRANT ALL ON TABLE "public"."athlete_evaluation_results" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_evaluation_results" TO "service_role";
GRANT ALL ON TABLE "public"."athlete_guardians" TO "anon";
GRANT ALL ON TABLE "public"."athlete_guardians" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_guardians" TO "service_role";
GRANT ALL ON TABLE "public"."athlete_positions" TO "anon";
GRANT ALL ON TABLE "public"."athlete_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_positions" TO "service_role";
GRANT ALL ON TABLE "public"."athlete_positionsbk" TO "anon";
GRANT ALL ON TABLE "public"."athlete_positionsbk" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_positionsbk" TO "service_role";
GRANT ALL ON TABLE "public"."athletes" TO "anon";
GRANT ALL ON TABLE "public"."athletes" TO "authenticated";
GRANT ALL ON TABLE "public"."athletes" TO "service_role";
GRANT ALL ON TABLE "public"."coaches" TO "anon";
GRANT ALL ON TABLE "public"."coaches" TO "authenticated";
GRANT ALL ON TABLE "public"."coaches" TO "service_role";
GRANT ALL ON TABLE "public"."drill_media" TO "anon";
GRANT ALL ON TABLE "public"."drill_media" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_media" TO "service_role";
GRANT ALL ON TABLE "public"."drill_media_import" TO "anon";
GRANT ALL ON TABLE "public"."drill_media_import" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_media_import" TO "service_role";
GRANT ALL ON TABLE "public"."drill_skills" TO "anon";
GRANT ALL ON TABLE "public"."drill_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_skills" TO "service_role";
GRANT ALL ON TABLE "public"."drill_steps" TO "anon";
GRANT ALL ON TABLE "public"."drill_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_steps" TO "service_role";
GRANT ALL ON TABLE "public"."drill_subskills" TO "anon";
GRANT ALL ON TABLE "public"."drill_subskills" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_subskills" TO "service_role";
GRANT ALL ON TABLE "public"."drill_tag_map" TO "anon";
GRANT ALL ON TABLE "public"."drill_tag_map" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_tag_map" TO "service_role";
GRANT ALL ON TABLE "public"."drill_tag_map_bk" TO "anon";
GRANT ALL ON TABLE "public"."drill_tag_map_bk" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_tag_map_bk" TO "service_role";
GRANT ALL ON TABLE "public"."drill_tag_map_bk2" TO "anon";
GRANT ALL ON TABLE "public"."drill_tag_map_bk2" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_tag_map_bk2" TO "service_role";
GRANT ALL ON TABLE "public"."drill_tags" TO "anon";
GRANT ALL ON TABLE "public"."drill_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_tags" TO "service_role";
GRANT ALL ON TABLE "public"."drills" TO "anon";
GRANT ALL ON TABLE "public"."drills" TO "authenticated";
GRANT ALL ON TABLE "public"."drills" TO "service_role";
GRANT ALL ON TABLE "public"."drillsbk07abr2026" TO "anon";
GRANT ALL ON TABLE "public"."drillsbk07abr2026" TO "authenticated";
GRANT ALL ON TABLE "public"."drillsbk07abr2026" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_items" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_items" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_itemsbk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_itemsbk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_itemsbk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_drills" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_drills" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_drills" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_drills_bk" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_drills_bk" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_drills_bk" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_drillsbk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_drillsbk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_drillsbk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_progress" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_progress" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_progress_bk" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_progress_bk" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_progress_bk" TO "service_role";
GRANT ALL ON TABLE "public"."evaluation_workout_progressbk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_workout_progressbk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_workout_progressbk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."evaluations" TO "anon";
GRANT ALL ON TABLE "public"."evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluations" TO "service_role";
GRANT ALL ON TABLE "public"."evaluationsbk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."evaluationsbk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluationsbk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."guardian_contacts" TO "anon";
GRANT ALL ON TABLE "public"."guardian_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."guardian_contacts" TO "service_role";
GRANT ALL ON TABLE "public"."join_codes" TO "anon";
GRANT ALL ON TABLE "public"."join_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."join_codes" TO "service_role";
GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT ALL ON TABLE "public"."org_branding" TO "anon";
GRANT ALL ON TABLE "public"."org_branding" TO "authenticated";
GRANT ALL ON TABLE "public"."org_branding" TO "service_role";
GRANT ALL ON TABLE "public"."org_members" TO "anon";
GRANT ALL ON TABLE "public"."org_members" TO "authenticated";
GRANT ALL ON TABLE "public"."org_members" TO "service_role";
GRANT ALL ON TABLE "public"."org_memberships" TO "anon";
GRANT ALL ON TABLE "public"."org_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."org_memberships" TO "service_role";
GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";
GRANT ALL ON TABLE "public"."positions" TO "anon";
GRANT ALL ON TABLE "public"."positions" TO "authenticated";
GRANT ALL ON TABLE "public"."positions" TO "service_role";
GRANT ALL ON TABLE "public"."practice_plan_assignments" TO "anon";
GRANT ALL ON TABLE "public"."practice_plan_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_plan_assignments" TO "service_role";
GRANT ALL ON TABLE "public"."practice_plan_invitations" TO "anon";
GRANT ALL ON TABLE "public"."practice_plan_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_plan_invitations" TO "service_role";
GRANT ALL ON TABLE "public"."practice_plan_items" TO "anon";
GRANT ALL ON TABLE "public"."practice_plan_items" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_plan_items" TO "service_role";
GRANT ALL ON TABLE "public"."practice_plan_members" TO "anon";
GRANT ALL ON TABLE "public"."practice_plan_members" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_plan_members" TO "service_role";
GRANT ALL ON TABLE "public"."practice_plans" TO "anon";
GRANT ALL ON TABLE "public"."practice_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_plans" TO "service_role";
GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT ALL ON TABLE "public"."recommendation_rules" TO "anon";
GRANT ALL ON TABLE "public"."recommendation_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendation_rules" TO "service_role";
GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";
GRANT ALL ON TABLE "public"."scorecard_categories" TO "anon";
GRANT ALL ON TABLE "public"."scorecard_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."scorecard_categories" TO "service_role";
GRANT ALL ON TABLE "public"."scorecard_subskills" TO "anon";
GRANT ALL ON TABLE "public"."scorecard_subskills" TO "authenticated";
GRANT ALL ON TABLE "public"."scorecard_subskills" TO "service_role";
GRANT ALL ON TABLE "public"."scorecard_templates" TO "anon";
GRANT ALL ON TABLE "public"."scorecard_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."scorecard_templates" TO "service_role";
GRANT ALL ON TABLE "public"."segments" TO "anon";
GRANT ALL ON TABLE "public"."segments" TO "authenticated";
GRANT ALL ON TABLE "public"."segments" TO "service_role";
GRANT ALL ON TABLE "public"."skill_drill_map" TO "anon";
GRANT ALL ON TABLE "public"."skill_drill_map" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_drill_map" TO "service_role";
GRANT ALL ON TABLE "public"."skill_drill_mapbk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."skill_drill_mapbk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_drill_mapbk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."skill_media" TO "anon";
GRANT ALL ON TABLE "public"."skill_media" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_media" TO "service_role";
GRANT ALL ON TABLE "public"."skill_mediabk27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."skill_mediabk27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_mediabk27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."skill_positions" TO "anon";
GRANT ALL ON TABLE "public"."skill_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_positions" TO "service_role";
GRANT ALL ON TABLE "public"."skill_tags" TO "anon";
GRANT ALL ON TABLE "public"."skill_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_tags" TO "service_role";
GRANT ALL ON TABLE "public"."skill_tags27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."skill_tags27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_tags27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."skill_video_map" TO "anon";
GRANT ALL ON TABLE "public"."skill_video_map" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_video_map" TO "service_role";
GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";
GRANT ALL ON TABLE "public"."skills27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."skills27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."skills27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."skills_27mar2026" TO "anon";
GRANT ALL ON TABLE "public"."skills_27mar2026" TO "authenticated";
GRANT ALL ON TABLE "public"."skills_27mar2026" TO "service_role";
GRANT ALL ON TABLE "public"."sports" TO "anon";
GRANT ALL ON TABLE "public"."sports" TO "authenticated";
GRANT ALL ON TABLE "public"."sports" TO "service_role";
GRANT ALL ON TABLE "public"."subskill_skill_links" TO "anon";
GRANT ALL ON TABLE "public"."subskill_skill_links" TO "authenticated";
GRANT ALL ON TABLE "public"."subskill_skill_links" TO "service_role";
GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";
GRANT ALL ON TABLE "public"."team_athletes" TO "anon";
GRANT ALL ON TABLE "public"."team_athletes" TO "authenticated";
GRANT ALL ON TABLE "public"."team_athletes" TO "service_role";
GRANT ALL ON TABLE "public"."team_memberships" TO "anon";
GRANT ALL ON TABLE "public"."team_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."team_memberships" TO "service_role";
GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";
GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT ALL ON TABLE "public"."video_assets" TO "anon";
GRANT ALL ON TABLE "public"."video_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."video_assets" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
