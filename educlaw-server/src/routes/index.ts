import { Router } from 'express';
import packageRoutes from './packages.js';
import arenaRoutes from './arena.js';
import actionRoutes from './actions.js';

const router: import('express').Router = Router();

router.use(actionRoutes);
router.use(packageRoutes);
router.use(arenaRoutes);

export default router;
