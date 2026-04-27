import { apiFetchJson, apiPost, apiPatch, BASE } from './client';

export function agentApi(agentId: string) {
  const prefix = `${BASE}/api/${agentId}`;

  return {
    // Sessions
    listSessions() {
      return apiFetchJson(`${prefix}/session`);
    },
    createSession() {
      return apiPost(`${prefix}/session`);
    },
    getSession(sessionId: string) {
      return apiFetchJson(`${prefix}/session/${sessionId}`);
    },
    deleteSession(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/delete`);
    },

    // Messages
    listMessages(sessionId: string, limit?: number) {
      const qs = limit ? `?limit=${limit}` : '';
      return apiFetchJson(`${prefix}/session/${sessionId}/message${qs}`);
    },
    sendMessage(sessionId: string, content: string, images?: { dataUrl: string; mime: string; filename: string }[], agent?: string) {
      const parts: { type: string; text?: string; url?: string; mime?: string; filename?: string }[] = [{ type: 'text', text: content }];
      if (images) {
        for (const img of images) {
          parts.push({ type: 'file', url: img.dataUrl, mime: img.mime, filename: img.filename });
        }
      }
      return apiPost(`${prefix}/session/${sessionId}/message`, { parts, agent });
    },
    abort(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/abort`);
    },

    // Todos
    listTodos(sessionId: string) {
      return apiFetchJson(`${prefix}/session/${sessionId}/todo`);
    },

    // Permissions
    respondPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') {
      return apiPost(`${prefix}/permission/${sessionId}/${permissionId}`, { response });
    },

    // Questions
    listQuestions() {
      return apiFetchJson(`${prefix}/question`);
    },
    questionReply(requestId: string, answers: string[][]) {
      return apiPost(`${prefix}/question/${requestId}/reply`, { answers });
    },
    questionReject(requestId: string) {
      return apiPost(`${prefix}/question/${requestId}/reject`);
    },

    // Message operations
    deleteMessage(sessionId: string, messageId: string) {
      return apiPost(`${prefix}/session/${sessionId}/message/${messageId}/delete`);
    },

    // Session operations
    forkSession(sessionId: string, messageId?: string) {
      return apiPost(`${prefix}/session/${sessionId}/fork`, { messageID: messageId });
    },
    shareSession(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/share`);
    },
    unshareSession(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/unshare`);
    },
    revertSession(sessionId: string, messageId?: string, partId?: string) {
      return apiPost(`${prefix}/session/${sessionId}/revert`, { messageID: messageId, partID: partId });
    },
    unrevertSession(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/unrevert`);
    },
    renameSession(sessionId: string, title: string) {
      return apiPatch(`${prefix}/session/${sessionId}`, { title });
    },
    archiveSession(sessionId: string) {
      return apiPatch(`${prefix}/session/${sessionId}`, { time: { archived: Date.now() } });
    },
    unarchiveSession(sessionId: string) {
      return apiPatch(`${prefix}/session/${sessionId}`, { time: { archived: 0 } });
    },
    compactSession(sessionId: string, providerID: string, modelID: string) {
      return apiPost(`${prefix}/session/${sessionId}/compact`, { providerID, modelID });
    },
    getConfig() {
      return apiFetchJson(`${prefix}/config`);
    },

    // OAH agents
    listAgents() {
      return apiFetchJson(`${prefix}/agent`);
    },

    // Custom commands
    listCommands() {
      return apiFetchJson(`${prefix}/command`);
    },
    sendCommand(sessionId: string, command: string, args: string, agent?: string, model?: string) {
      return apiPost(`${prefix}/session/${sessionId}/command`, { command, arguments: args, agent, model });
    },

    // Shell mode
    sendShell(sessionId: string, command: string, agent?: string, model?: { providerID: string; modelID: string }) {
      return apiPost(`${prefix}/session/${sessionId}/shell`, { command, agent, model });
    },
  };
}