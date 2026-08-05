-- Minimal local seed: lookup data required for signup.
-- Extracted from be-prod/supabase/dumps/data.sql
-- Includes debug org matching fe VITE_DEBUG_ORG_ID (positions/list on SignUp).
-- Register additional orgs and users via the app after reset.

SET session_replication_role = replica;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET row_security = off;

--
-- sports
--

INSERT INTO "public"."sports" ("id", "code", "name", "created_at", "updated_at") VALUES
	('e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', 'lacrosse', 'Lacrosse', '2026-05-06 12:16:24.977051+00', '2026-05-06 12:16:24.977051+00'),
	('d4db1bea-5df9-4d15-9a5a-ac2fe8d24b2c', 'soccer', 'Soccer', '2026-05-06 12:16:24.977051+00', '2026-05-06 12:16:24.977051+00'),
	('c059b081-a9b5-4e1d-a0f4-01e8ae70a508', 'basketball', 'Basketball', '2026-05-06 12:16:24.977051+00', '2026-05-06 12:16:24.977051+00');

--
-- debug org (VITE_DEBUG_ORG_ID) — positions/list resolves sport via this org
--

INSERT INTO "public"."organizations" ("id", "name", "slug", "sport_mode", "program_gender", "maxBelowThresholdRatingsAllowed", "maxWorkoutReps", "sport_id", "created_at", "updated_at") VALUES
	('7498990d-aa4c-401d-92a7-67152514858a', 'ANKOR Lacrosse Club', 'ankor-lacrosse', 'single', 'coed', 3, 10, 'e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', '2025-10-22 13:04:35.132919+00', '2026-05-10 16:11:04.033593+00');

--
-- positions (lacrosse)
--

INSERT INTO "public"."positions" ("id", "sport_id", "code", "name", "created_at", "updated_at") VALUES
	('7782da84-3141-401e-916a-66524dacbfcf', 'e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', 'A', 'Attack', '2026-05-06 12:16:25.451349+00', '2026-05-06 12:16:25.451349+00'),
	('64669c53-44c3-48fc-8fbf-cb2c157675d0', 'e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', 'M', 'Midfield', '2026-05-06 12:16:25.451349+00', '2026-05-06 12:16:25.451349+00'),
	('0eea483b-3700-4517-875c-8fecb6f7fbeb', 'e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', 'D', 'Defense', '2026-05-06 12:16:25.451349+00', '2026-05-06 12:16:25.451349+00'),
	('c409fe1d-b876-4009-b7a6-b432759991ea', 'e252ebdf-a9f5-4f99-8e08-48d7afbabd9c', 'G', 'Goalie', '2026-05-06 12:16:25.451349+00', '2026-05-06 12:16:25.451349+00');

--
-- storage buckets (media uploads)
--

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES
	('DRILLS_MEDIA_BUCKET', 'DRILLS_MEDIA_BUCKET', NULL, '2025-12-26 02:29:16.097524+00', '2025-12-26 02:29:16.097524+00', true, false, NULL, NULL, NULL, 'STANDARD'),
	('SKILLS_MEDIA_BUCKET', 'SKILLS_MEDIA_BUCKET', NULL, '2026-01-19 14:40:13.537017+00', '2026-01-19 14:40:13.537017+00', true, false, NULL, NULL, NULL, 'STANDARD');

SET session_replication_role = DEFAULT;
