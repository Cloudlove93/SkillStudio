import { create } from 'zustand';

export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'high' | 'medium' | 'low';
}

interface TodoStore {
  /** Map of agentId → sessionId → Todo[] */
  todos: Map<string, Map<string, Todo[]>>;

  handleTodoUpdate: (agentId: string, data: { sessionID?: string; todos?: unknown } | Todo[]) => void;
  getTodos: (agentId: string, sessionId: string) => Todo[];
  clearSession: (agentId: string, sessionId: string) => void;
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: new Map(),

  handleTodoUpdate(agentId, data) {
    const { todos } = get();
    const payload = Array.isArray(data) ? { todos: data } : data;
    const sessionId = payload.sessionID ?? '';
    const items = Array.isArray(payload.todos) ? payload.todos : [];

    const newTodos = new Map(todos);
    const agentMap = new Map(newTodos.get(agentId) ?? []);
    agentMap.set(sessionId, items.map((t) => ({
      id: t.id ?? '',
      content: t.content ?? t.subject ?? '',
      status: t.status ?? 'pending',
      priority: t.priority,
    })));
    newTodos.set(agentId, agentMap);
    set({ todos: newTodos });
  },

  getTodos(agentId, sessionId) {
    return get().todos.get(agentId)?.get(sessionId) ?? [];
  },

  clearSession(agentId, sessionId) {
    const { todos } = get();
    const newTodos = new Map(todos);
    const agentMap = new Map(newTodos.get(agentId) ?? []);
    agentMap.delete(sessionId);
    newTodos.set(agentId, agentMap);
    set({ todos: newTodos });
  },
}));
