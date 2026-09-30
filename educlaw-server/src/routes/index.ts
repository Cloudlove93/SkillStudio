import { Router } from 'express';
import packageRoutes from './packages.js';
import arenaRoutes from './arena.js';
import actionRoutes from './actions.js';
import answerSkillOptimizationRoutes from './answer-skill-optimizations.js';
import skillRoutes from './skills.js';

const router: import('express').Router = Router();

router.use(actionRoutes);
router.use(packageRoutes);
router.use(arenaRoutes);
router.use(answerSkillOptimizationRoutes);
router.use(skillRoutes);

export default router;
