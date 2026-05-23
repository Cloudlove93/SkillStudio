import { Router } from "express";
import authRoutes from "./auth.js";
import packageRoutes from "./packages.js";
import arenaRoutes from "./arena.js";

const router: import("express").Router = Router();

router.use(authRoutes);
router.use(packageRoutes);
router.use(arenaRoutes);

export default router;
