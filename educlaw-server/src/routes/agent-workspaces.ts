import { Router } from 'express';
import { createTrackedRouter } from '../services/http-drain.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedRequest } from '../types.js';
import {
  AgentWorkspaceError,
  listAgents,
  getAgent,
  saveAgent,
  provisionAgent,
  listAgentConversations,
  createAgentConversation,
} from '../services/agent-workspace-service.js';
const router: import('express').Router = createTrackedRouter(Router());
function handle(
  work: (userId: string, id: string, body: unknown) => Promise<unknown>,
): import('express').RequestHandler {
  return async (req, res) => {
    try {
      res.json(
        await work(
          (req as AuthedRequest).userId!,
          String(req.params.agentId || ''),
          req.body,
        ),
      );
    } catch (error) {
      res
        .status(error instanceof AgentWorkspaceError ? error.status : 500)
        .json({
          error:
            error instanceof AgentWorkspaceError
              ? error.message
              : 'Agent 操作失败',
          code:
            error instanceof AgentWorkspaceError ? error.code : 'AGENT_ERROR',
        });
    }
  };
}
router.get(
  '/agent-workspaces',
  requireAuth,
  handle((user) => listAgents(user)),
);
router.post(
  '/agent-workspaces',
  requireAuth,
  handle((user, _id, body) => saveAgent(user, body)),
);
router.post(
  '/agent-workspaces/provision',
  requireAuth,
  handle((user, _id, body) => provisionAgent(user, body)),
);
router.get(
  '/agent-workspaces/:agentId',
  requireAuth,
  handle((user, id) => getAgent(user, id)),
);
router.put(
  '/agent-workspaces/:agentId',
  requireAuth,
  handle((user, id, body) => saveAgent(user, body, id)),
);
router.get(
  '/agent-workspaces/:agentId/conversations',
  requireAuth,
  handle((user, id) => listAgentConversations(user, id)),
);
router.post(
  '/agent-workspaces/:agentId/conversations',
  requireAuth,
  handle(createAgentConversation),
);
export default router;
