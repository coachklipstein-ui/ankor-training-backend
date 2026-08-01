import { Router } from "./router.ts";
import { handleSportsList } from "../controllers/sports.controller.ts";

export function createSportsRouter(): Router {
  const router = new Router();

  // GET /api/sports/list
  router.add("GET", "list", handleSportsList);

  return router;
}
