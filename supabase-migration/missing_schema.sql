create extension if not exists pgcrypto;

create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id) on delete cascade,
  code text not null,
  name text not null,
  unique (sport_id, code)
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  program_gender text not null check (program_gender in ('girls', 'boys', 'coed')),
  sport_mode text null,
  slug text not null unique,
  sport_id uuid null references public.sports(id),
  "maxWorkoutReps" integer null,
  "maxBelowThresholdRatingsAllowed" integer null,
  created_at timestamp with time zone null,
  updated_at timestamp with time zone null
);

alter table public.organizations
add column if not exists sport_mode text null;

alter table public.organizations
add column if not exists created_at timestamp with time zone null;

alter table public.organizations
add column if not exists updated_at timestamp with time zone null;

alter table public.organizations
add column if not exists "maxBelowThresholdRatingsAllowed" integer null;
