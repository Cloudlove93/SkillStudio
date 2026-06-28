import { Router } from "express";
import packageRoutes from "./packages.js";
import arenaRoutes from "./arena.js";

const router: import("express").Router = Router();

router.use(packageRoutes);
router.use(arenaRoutes);

export default router;
