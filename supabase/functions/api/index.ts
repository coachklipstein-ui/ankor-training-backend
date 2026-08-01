/// <reference no-default-lib="true"/>
/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

import { Router } from "./routes/router.ts";
import { corsHeaders } from "./utils/cors.ts";
import { notFound, serverError } from "./utils/responses.ts";

// Routers
import { createScorecardsRouter } from "./routes/scorecard.router.ts";
// ... other routers
import { createAuthRouter } from "./routes/auth.router.ts";
import { createOrgRouter } from "./routes/org.router.ts";
import { createSkillsRouter } from "./routes/skills.router.ts";
import { createEvaluationsRouter } from "./routes/evaluations.router.ts";
import { createTeamsRouter } from "./routes/teams.router.ts";
import { createCoachesRouter } from "./routes/coaches.router.ts";
import { createAthletesRouter } from "./routes/athletes.router.ts";
import { createGuardiansRouter } from "./routes/guardians.router.ts";
import { createDrillsRouter } from "./routes/drills.router.ts";
import { createSkillDrillMapRouter } from "./routes/skill_drill_map.router.ts";
import { createPlansRouter } from "./routes/plans.router.ts";
import { createUsersRouter } from "./routes/users.router.ts";
import { createJoinCodesRouter } from "./routes/join_codes.router.ts";
import { createPositionsRouter } from "./routes/positions.router.ts";
import { createSportsRouter } from "./routes/sports.router.ts";
import { authMiddleware } from "./utils/auth.ts";

const router = new Router();
const requireAuth = authMiddleware();

// Mount resource routers
router.use("auth", createAuthRouter());
router.use("org", createOrgRouter());
router.use("scorecard", createScorecardsRouter(), [requireAuth]);
router.use("skills", createSkillsRouter(), [requireAuth]);
router.use("teams", createTeamsRouter(), [requireAuth]);
router.use("athletes", createAthletesRouter(), [requireAuth]);
router.use("coaches", createCoachesRouter(), [requireAuth]);
router.use("guardians", createGuardiansRouter(), [requireAuth]);
router.use("parents", createGuardiansRouter(), [requireAuth]);
router.use("evaluations", createEvaluationsRouter(), [requireAuth]);
router.use("drills", createDrillsRouter(), [requireAuth]);
router.use("skill-drill-map", createSkillDrillMapRouter(), [requireAuth]);
router.use("plans", createPlansRouter(), [requireAuth]);
router.use("users", createUsersRouter(), [requireAuth]);
router.use("join-codes", createJoinCodesRouter(), [requireAuth]);
router.use("positions", createPositionsRouter());
router.use("sports", createSportsRouter());

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const u = new URL(req.url);

    let subpath = u.pathname;
    // Support both Supabase runtime (already stripped) and local/dev paths.
    subpath = subpath.replace(/^\/functions\/v1\/api\/?/, "");
    subpath = subpath.replace(/^\/api\/?/, "");
    subpath = subpath.replace(/^\/+/, "");

    const res = await router.handle(req.method, subpath, req, origin);
    return res ?? notFound(`Not found: ${req.method} /${subpath || ""}`, origin);
  } catch (err) {
    return serverError(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, origin);
  }
});
