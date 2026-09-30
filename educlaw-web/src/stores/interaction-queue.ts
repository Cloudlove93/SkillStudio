import { create } from 'zustand';

// ── Permission types ─────────────────────────────────────────

export interface PendingPermission {
  id: string;
  agentId: string;
  sessionID?: string;
  permission?: string;
  patterns?: string[];
  toolName: string;
  input?: Record<string, unknown>;
  message?: string;
}

// ── Question types ───────────────────────────────────────────

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionRequest {
  id: string;
  agentId: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
}

// ── Store ────────────────────────────────────────────────────

interface InteractionQueueStore {
  pendingPermissions: PendingPermission[];
  pendingQuestions: QuestionRequest[];

  addPermission: (p: PendingPermission) => void;
  removePermission: (id: string) => void;

  addQuestion: (req: QuestionRequest) => void;
  removeQuestion: (requestId: string) => void;
}

export const useInteractionQueueStore = create<InteractionQueueStore>((set) => ({
  pendingPermissions: [],
  pendingQuestions: [],

  addPermission(p) {
    set((s) => {
      if (s.pendingPermissions.some((x) => x.id === p.id)) return s;
      return { pendingPermissions: [...s.pendingPermissions, p] };
    });
  },

  removePermission(id) {
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.id !== id) }));
  },

  addQuestion(req) {
    set((s) => {
      if (s.pendingQuestions.some((p) => p.id === req.id)) return s;
      return { pendingQuestions: [...s.pendingQuestions, req] };
    });
  },

  removeQuestion(requestId) {
    set((s) => ({ pendingQuestions: s.pendingQuestions.filter((p) => p.id !== requestId) }));
  },
}));
