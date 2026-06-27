import { apiFetchJson, apiPost, apiPatch } from './client';

export function agentRuntimeApi(agentId: string) {
  const prefix = `/api/${agentId}`;

  return {
    listSessions() {
      return apiFetchJson(`${prefix}/session`);
    },
    createSession(options?: { agentName?: string }) {
      return apiPost(`${prefix}/session`, options);
    },
    getSession(sessionId: string) {
      return apiFetchJson(`${prefix}/session/${sessionId}`);
    },
    deleteSession(sessionId: string) {
      return apiPost(`${prefix}/session/${sessionId}/delete`);
    },
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
    listTodos(sessionId: string) {
      return apiFetchJson(`${prefix}/session/${sessionId}/todo`);
    },
    respondPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') {
      return apiPost(`${prefix}/permission/${sessionId}/${permissionId}`, { response });
    },
    listQuestions() {
      return apiFetchJson(`${prefix}/question`);
    },
    questionReply(requestId: string, answers: string[][]) {
      return apiPost(`${prefix}/question/${requestId}/reply`, { answers });
    },
    questionReject(requestId: string) {
      return apiPost(`${prefix}/question/${requestId}/reject`);
    },
    deleteMessage(sessionId: string, messageId: string) {
      return apiPost(`${prefix}/session/${sessionId}/message/${messageId}/delete`);
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
    getConfig() {
      return apiFetchJson(`${prefix}/config`);
    },
    listAgents() {
      return apiFetchJson(`${prefix}/agent`);
    },
    listCommands() {
      return apiFetchJson(`${prefix}/command`);
    },
    sendCommand(sessionId: string, command: string, args: string, agent?: string, model?: string) {
      return apiPost(`${prefix}/session/${sessionId}/command`, { command, arguments: args, agent, model });
    },
    sendShell(sessionId: string, command: string, agent?: string, model?: { providerID: string; modelID: string }) {
      return apiPost(`${prefix}/session/${sessionId}/shell`, { command, agent, model });
    },
  };
}
