import { Router } from 'express';
import packageRoutes from './packages.js';
import arenaRoutes from './arena.js';
import actionRoutes from './actions.js';
import answerSkillOptimizationRoutes from './answer-skill-optimizations.js';
import skillRoutes from './skills.js';
import agentWorkspaceRoutes from './agent-workspaces.js';
import workflowRoutes from './workflow.js';

const router: import('express').Router = Router();

router.use(agentWorkspaceRoutes);
router.use(actionRoutes);
router.use(packageRoutes);
router.use(arenaRoutes);
router.use(answerSkillOptimizationRoutes);
router.use(skillRoutes);
router.use(workflowRoutes);

export default router;
