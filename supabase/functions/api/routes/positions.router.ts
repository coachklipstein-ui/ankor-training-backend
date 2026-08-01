// src/routes/positions.router.ts
import { Router } from "./router.ts";
import { handlePositionsList } from "../controllers/positions.controller.ts";

export function createPositionsRouter(): Router {
  const router = new Router();

  // GET /api/positions/list
  router.add("GET", "list", handlePositionsList);

  return router;
}
