import type { RequestHandler } from 'express';

export const AGENT_REQUIRED_MESSAGE =
  '请从“我的 Agent”进入对话；如需使用此 Skill，请先在 Agent 编辑配置中启用它';

/** Old creation URLs remain reachable, but cannot create skill-only chats. */
export const requireAgentConversation: RequestHandler = (_req, res) => {
  res.status(422).json({
    code: 'AGENT_REQUIRED',
    error: AGENT_REQUIRED_MESSAGE,
    nextUrl: '/agents',
  });
};
