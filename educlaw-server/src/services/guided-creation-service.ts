import type {
  AgentPackageSnapshot,
  GuidedConfirmationCard,
  GuidedCreationDocument,
  GuidedCreationMessage,
  GuidedCreationSession,
  GuidedCreationSessionDetail,
  GuidedCreationStatus,
  GuidedDraftField,
  GuidedFieldState,
  GuidedSkillDraft,
} from '@educlaw/shared';
import { query, withTransaction } from './db.js';
import { generateJson } from './llm-service.js';
import {
  buildGeneratedPackageSnapshot,
  createPackageWithSnapshotTx,
} from './package-service.js';
import {
  applyDraftOperations,
  applyFieldStateOperations,
  buildConfirmationCard,
  evaluateDraft,
  GUIDED_DRAFT_FIELDS,
  type DraftOperation,
} from './guided-creation-policy.js';

export interface GuidedExtractionResult {
  operations: DraftOperation[];
  acknowledgement: string;
}

export interface GuidedQuestionPhrasing {
  field?: string;
  question: string;
  suggested_options: string[];
}

export interface GuidedAssistantTurn {
  draft: GuidedSkillDraft;
  field_states: Record<GuidedDraftField, GuidedFieldState>;
  status: Extract<
    GuidedCreationStatus,
    'collecting' | 'ready_for_confirmation'
  >;
  next_blocking_field: GuidedDraftField | null;
  acknowledgement: string;
  content: string;
  suggested_options: string[];
  confirmation: GuidedConfirmationCard | null;
}

const DRAFT_FIELD_SET = new Set<string>(GUIDED_DRAFT_FIELDS);
const OPERATION_SET = new Set(['set', 'replace', 'remove']);
const EXTRACTION_STATE_SET = new Set(['explicit', 'inferred', 'conflicted']);

const FALLBACK_QUESTIONS: Record<GuidedDraftField, string> = {
  roles: '这个 Skill 主要给谁使用，并希望它扮演什么角色？',
  goal: '你最希望这个 Skill 帮你完成什么目标？',
  usage_scenario: '通常会在什么教学场景中使用它？',
  input_contract: '使用时，你会提供哪些信息或材料？',
  output_contract: '你希望它最终输出什么内容和格式？',
  core_capabilities: '它必须具备哪些核心能力？',
  workflow: '你希望它按照怎样的步骤完成任务？',
  knowledge_evidence: '它应优先依据哪些材料或知识？',
  boundaries_permissions: '有哪些明确不能做的事情或权限边界？',
  exception_recovery: '信息不足或处理失败时，希望它如何处理？',
  completion_evidence: '满足什么条件时可以认为任务已经完成？',
};

const FALLBACK_OPTIONS: Partial<Record<GuidedDraftField, string[]>> = {
  roles: ['教师', '教研员', '学生'],
  goal: ['生成教学内容', '分析学习表现', '提供教学建议'],
  usage_scenario: ['课前备课', '课堂教学', '课后复盘'],
  input_contract: ['教学目标和教材', '课堂记录', '学生作业或数据'],
  output_contract: ['结构化方案', '分析报告', '可直接使用的文本'],
  core_capabilities: ['提炼关键信息', '生成内容', '检查质量'],
  workflow: ['分析输入后生成', '分步骤与用户确认', '生成后自动检查'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanAcknowledgement(value: string): string {
  const cleaned = value.replace(/[？?]+/g, '。').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200) || '明白了。';
}

export function parseExtractionResult(value: unknown): GuidedExtractionResult {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    throw new Error('INVALID_MODEL_EXTRACTION');
  }
  if (
    typeof value.acknowledgement !== 'string' ||
    !value.acknowledgement.trim() ||
    value.operations.length > GUIDED_DRAFT_FIELDS.length * 2
  ) {
    throw new Error('INVALID_MODEL_EXTRACTION');
  }

  const operations: DraftOperation[] = value.operations.map((operation) => {
    if (
      !isRecord(operation) ||
      typeof operation.op !== 'string' ||
      !OPERATION_SET.has(operation.op) ||
      typeof operation.path !== 'string' ||
      !DRAFT_FIELD_SET.has(operation.path)
    ) {
      throw new Error('INVALID_MODEL_EXTRACTION');
    }
    if (operation.op !== 'remove') {
      if (typeof operation.value !== 'string' || !operation.value.trim()) {
        throw new Error('INVALID_MODEL_EXTRACTION');
      }
    }
    if (
      operation.state !== undefined &&
      (typeof operation.state !== 'string' ||
        !EXTRACTION_STATE_SET.has(operation.state))
    ) {
      throw new Error('INVALID_MODEL_EXTRACTION');
    }
    return {
      op: operation.op as DraftOperation['op'],
      path: operation.path,
      value: operation.value,
      state: operation.state as DraftOperation['state'],
    };
  });

  return {
    operations,
    acknowledgement: cleanAcknowledgement(value.acknowledgement),
  };
}

function parsePhrasing(
  phrasing: GuidedQuestionPhrasing | null,
  field: GuidedDraftField,
): { question: string; suggested_options: string[] } {
  const fallbackQuestion = FALLBACK_QUESTIONS[field];
  const candidate = phrasing?.question?.replace(/\s+/g, ' ').trim() ?? '';
  const questionMarks = candidate.match(/[？?]/g)?.length ?? 0;
  const usesExpectedField = !phrasing?.field || phrasing.field === field;
  const question =
    usesExpectedField && questionMarks === 1 && candidate.length <= 120
      ? candidate.replace(/\?$/, '？')
      : fallbackQuestion;

  const candidateOptions = Array.isArray(phrasing?.suggested_options)
    ? phrasing.suggested_options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const suggested_options =
    candidateOptions.length >= 2
      ? candidateOptions
      : (FALLBACK_OPTIONS[field] ?? []).slice(0, 4);

  return { question, suggested_options };
}

export function buildGuidedAssistantTurn(input: {
  current_draft: GuidedSkillDraft;
  current_field_states: Partial<Record<GuidedDraftField, GuidedFieldState>>;
  extraction: GuidedExtractionResult;
  phrasing: GuidedQuestionPhrasing | null;
}): GuidedAssistantTurn {
  const draft = applyDraftOperations(
    input.current_draft,
    input.extraction.operations,
  );
  const stateOverrides = applyFieldStateOperations(
    input.current_field_states,
    input.extraction.operations,
  );
  const evaluation = evaluateDraft(draft, stateOverrides);
  const acknowledgement = cleanAcknowledgement(input.extraction.acknowledgement);

  if (evaluation.ready_for_confirmation) {
    return {
      draft: evaluation.normalized_draft,
      field_states: evaluation.field_states,
      status: 'ready_for_confirmation',
      next_blocking_field: null,
      acknowledgement,
      content: `${acknowledgement}\n\n信息已经完整，请检查确认内容。确认后我会生成这个 Skill。`,
      suggested_options: [],
      confirmation: buildConfirmationCard(evaluation.normalized_draft),
    };
  }

  const nextField = evaluation.next_blocking_field!;
  const { question, suggested_options } = parsePhrasing(
    input.phrasing,
    nextField,
  );
  return {
    draft: evaluation.normalized_draft,
    field_states: evaluation.field_states,
    status: 'collecting',
    next_blocking_field: nextField,
    acknowledgement,
    content: `${acknowledgement}\n\n${question}`,
    suggested_options,
    confirmation: null,
  };
}

const MAX_MESSAGE_CHARS = 12_000;
const MAX_DOCUMENTS = 10;
const MAX_DOCUMENT_CHARS = 12_000;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const GUIDED_FINALIZE_LEASE_MS = 10 * 60 * 1_000;
const GUIDED_MESSAGE_LEASE_MS = 2 * 60 * 1_000;

export class GuidedCreationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GuidedCreationError';
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T | null | undefined) ?? fallback;
}

function asNullableId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapSession(row: Record<string, unknown>): GuidedCreationSession {
  const draft = parseJson<GuidedSkillDraft>(row.draft_json, {});
  const storedStates = parseJson<
    Partial<Record<GuidedDraftField, GuidedFieldState>>
  >(row.field_states_json, {});
  const evaluation = evaluateDraft(draft, storedStates);
  return {
    id: String(row.id),
    status: row.status as GuidedCreationStatus,
    model: typeof row.model === 'string' ? row.model : null,
    documents: parseJson<GuidedCreationDocument[]>(row.documents_json, []),
    draft: evaluation.normalized_draft,
    field_states: evaluation.field_states,
    confirmation: parseJson<GuidedConfirmationCard | null>(
      row.confirmation_json,
      null,
    ),
    revision_no: Number(row.revision_no),
    package_id: asNullableId(row.package_id),
    skill_id: asNullableId(row.skill_id),
    skill_version_id: asNullableId(row.skill_version_id),
    error: parseJson<Record<string, unknown> | null>(row.error_json, null),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    completed_at: row.completed_at ? asIso(row.completed_at) : null,
  };
}

function mapMessage(row: Record<string, unknown>): GuidedCreationMessage {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    message_no: Number(row.message_no),
    client_message_id:
      typeof row.client_message_id === 'string'
        ? row.client_message_id
        : null,
    role: row.role as GuidedCreationMessage['role'],
    content: String(row.content),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: asIso(row.created_at),
  };
}

function normalizeDocuments(
  documents: GuidedCreationDocument[] | undefined,
): GuidedCreationDocument[] {
  if (documents === undefined) return [];
  if (!Array.isArray(documents) || documents.length > MAX_DOCUMENTS) {
    throw new GuidedCreationError(
      'INVALID_DOCUMENTS',
      '参考材料数量不符合要求',
      400,
    );
  }
  return documents.map((document) => {
    if (
      !isRecord(document) ||
      typeof document.name !== 'string' ||
      !document.name.trim() ||
      typeof document.content !== 'string' ||
      !document.content.trim() ||
      document.content.length > MAX_DOCUMENT_CHARS
    ) {
      throw new GuidedCreationError(
        'INVALID_DOCUMENT',
        '参考材料格式不正确或内容过长',
        400,
      );
    }
    return {
      name: document.name.trim().slice(0, 200),
      content: document.content.trim(),
      ...(typeof document.mime_type === 'string' && document.mime_type.trim()
        ? { mime_type: document.mime_type.trim().slice(0, 100) }
        : {}),
    };
  });
}

function normalizeMessage(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GuidedCreationError('INVALID_MESSAGE', '请输入 Skill 需求', 400);
  }
  if (value.length > MAX_MESSAGE_CHARS) {
    throw new GuidedCreationError('MESSAGE_TOO_LONG', '消息内容过长', 400);
  }
  return value.trim();
}

function normalizeClientMessageId(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)
  ) {
    throw new GuidedCreationError(
      'INVALID_CLIENT_MESSAGE_ID',
      'client_message_id 格式不正确',
      400,
    );
  }
  return value;
}

export async function getGuidedCreationDetail(input: {
  auth_user_id: string;
  session_id: string;
}): Promise<GuidedCreationSessionDetail> {
  const sessionResult = await query<Record<string, unknown>>(
    `select *
       from skill_guided_creation_sessions
      where id = $1 and user_id = $2`,
    [input.session_id, input.auth_user_id],
  );
  const row = sessionResult.rows[0];
  if (!row) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_NOT_FOUND',
      '没有找到这个 Skill 草稿',
      404,
    );
  }
  const messageResult = await query<Record<string, unknown>>(
    `select m.*
       from skill_guided_creation_messages m
       join skill_guided_creation_sessions s on s.id = m.session_id
      where m.session_id = $1 and s.user_id = $2
      order by m.message_no asc`,
    [input.session_id, input.auth_user_id],
  );
  return { ...mapSession(row), messages: messageResult.rows.map(mapMessage) };
}

export async function listGuidedCreations(input: {
  auth_user_id: string;
  status?: GuidedCreationStatus[];
  limit?: number;
  cursor?: string;
}): Promise<{ items: GuidedCreationSession[]; next_cursor: string | null }> {
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIST_LIMIT)),
  );
  const values: unknown[] = [input.auth_user_id];
  const where = ['user_id = $1'];
  if (input.status?.length) {
    values.push(input.status);
    where.push(`status = any($${values.length}::text[])`);
  }
  if (input.cursor) {
    values.push(input.cursor);
    where.push(`updated_at < $${values.length}::timestamptz`);
  }
  values.push(limit + 1);
  const result = await query<Record<string, unknown>>(
    `select *
       from skill_guided_creation_sessions
      where ${where.join(' and ')}
      order by updated_at desc, id desc
      limit $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(mapSession),
    next_cursor: hasMore ? asIso(rows[rows.length - 1]?.updated_at) : null,
  };
}

function extractionPrompt(input: {
  draft: GuidedSkillDraft;
  messages: GuidedCreationMessage[];
  content: string;
  documents: GuidedCreationDocument[];
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const history = [...input.messages, { role: 'user', content: input.content }]
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  const documentSummary = input.documents
    .map((document) => `# ${document.name}\n${document.content}`)
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_CHARS);
  return {
    systemPrompt:
      '你负责从教育 Skill 对话中提取结构化信息。只返回 JSON。operations 只能使用 set、replace、remove，path 只能来自给定字段；不要自行决定是否完成，也不要提出问题。state 只能是 explicit、inferred、conflicted。',
    userPrompt: `字段：${GUIDED_DRAFT_FIELDS.join(', ')}\n当前草案：${JSON.stringify(input.draft)}\n对话：\n${history}\n参考材料：\n${documentSummary || '无'}\n返回：{"operations":[],"acknowledgement":"一句简短确认"}`,
    maxTokens: 1_200,
  };
}

function phrasingPrompt(input: {
  field: GuidedDraftField;
  draft: GuidedSkillDraft;
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  return {
    systemPrompt:
      '你负责把一个确定的追问写得自然、简短。只能问一个问题，不得追问其他字段。给出 2 到 4 个可选短答案，同时允许用户自由输入。只返回 JSON。',
    userPrompt: `必须询问字段：${input.field}\n当前草案：${JSON.stringify(input.draft)}\n返回：{"field":"${input.field}","question":"一个问题？","suggested_options":["选项1","选项2"]}`,
    maxTokens: 400,
  };
}

async function generateAssistantTurn(input: {
  session: GuidedCreationSessionDetail;
  content: string;
}): Promise<GuidedAssistantTurn> {
  const rawExtraction = await generateJson<unknown>(
    extractionPrompt({
      draft: input.session.draft,
      messages: input.session.messages,
      content: input.content,
      documents: input.session.documents,
    }),
  );
  const extraction = parseExtractionResult(rawExtraction);
  const previewDraft = applyDraftOperations(
    input.session.draft,
    extraction.operations,
  );
  const previewStates = applyFieldStateOperations(
    input.session.field_states,
    extraction.operations,
  );
  const previewEvaluation = evaluateDraft(previewDraft, previewStates);
  let phrasing: GuidedQuestionPhrasing | null = null;
  if (previewEvaluation.next_blocking_field) {
    const rawPhrasing = await generateJson<unknown>(
      phrasingPrompt({
        field: previewEvaluation.next_blocking_field,
        draft: previewEvaluation.normalized_draft,
      }),
    );
    if (isRecord(rawPhrasing)) {
      phrasing = {
        field:
          typeof rawPhrasing.field === 'string'
            ? rawPhrasing.field
            : undefined,
        question:
          typeof rawPhrasing.question === 'string'
            ? rawPhrasing.question
            : '',
        suggested_options: Array.isArray(rawPhrasing.suggested_options)
          ? rawPhrasing.suggested_options.filter(
              (option): option is string => typeof option === 'string',
            )
          : [],
      };
    }
  }
  return buildGuidedAssistantTurn({
    current_draft: input.session.draft,
    current_field_states: input.session.field_states,
    extraction,
    phrasing,
  });
}

export async function processGuidedCreationMessage(input: {
  auth_user_id: string;
  session_id: string;
  client_message_id: string;
  revision_no: number;
  content: string;
}): Promise<GuidedCreationSessionDetail> {
  let content = normalizeMessage(input.content);
  const clientMessageId = normalizeClientMessageId(input.client_message_id);
  let session = await getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
  const existingUserMessage = session.messages.find(
    (message) => message.client_message_id === clientMessageId,
  );
  const existingAssistantMessage = session.messages.find(
    (message) =>
      message.role === 'assistant' &&
      message.metadata.reply_to_client_message_id === clientMessageId,
  );
  if (existingUserMessage && existingAssistantMessage) return session;

  let acceptedRevision: number;
  let userMessageNo: number;
  if (existingUserMessage) {
    const messageLeaseExpired =
      session.status === 'collecting' &&
      Date.now() - new Date(session.updated_at).getTime() >= GUIDED_MESSAGE_LEASE_MS;
    if (session.status !== 'failed' && !messageLeaseExpired) {
      throw new GuidedCreationError(
        'MESSAGE_PROCESSING',
        '这条消息正在处理中',
        409,
        true,
      );
    }
    const reclaimed = await query(
      messageLeaseExpired
        ? `update skill_guided_creation_sessions
              set status = 'collecting',
                  error_json = null,
                  updated_at = now()
            where id = $1
              and user_id = $2
              and revision_no = $3
              and status = 'collecting'
              and updated_at < now() - interval '2 minutes'`
        : `update skill_guided_creation_sessions
              set status = 'collecting',
                  error_json = null,
                  updated_at = now()
            where id = $1
              and user_id = $2
              and revision_no = $3
              and status = 'failed'`,
      [input.session_id, input.auth_user_id, session.revision_no],
    );
    if (reclaimed.rowCount !== 1) {
      throw new GuidedCreationError(
        'MESSAGE_PROCESSING',
        '这条消息正在处理中',
        409,
        true,
      );
    }
    content = existingUserMessage.content;
    acceptedRevision = session.revision_no;
    userMessageNo = existingUserMessage.message_no;
    session = {
      ...session,
      status: 'collecting',
      error: null,
      messages: session.messages.filter(
        (message) => message.id !== existingUserMessage.id,
      ),
    };
  } else {
    if (
      session.status === 'completed' ||
      session.status === 'cancelled' ||
      session.status === 'finalizing'
    ) {
      throw new GuidedCreationError(
        'GUIDED_SESSION_NOT_EDITABLE',
        '当前 Skill 草稿不能继续编辑',
        409,
      );
    }
    if (session.revision_no !== input.revision_no) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
    const accepted = await withTransaction(async (client) => {
      const locked = await client.query<Record<string, unknown>>(
        `select revision_no, status
           from skill_guided_creation_sessions
          where id = $1 and user_id = $2
          for update`,
        [input.session_id, input.auth_user_id],
      );
      const lockedRow = locked.rows[0];
      if (!lockedRow) {
        throw new GuidedCreationError(
          'GUIDED_SESSION_NOT_FOUND',
          '没有找到这个 Skill 草稿',
          404,
        );
      }
      const duplicate = await client.query<Record<string, unknown>>(
        `select message_no
           from skill_guided_creation_messages
          where session_id = $1 and client_message_id = $2`,
        [input.session_id, clientMessageId],
      );
      if (duplicate.rows[0]) {
        return {
          inserted: false,
          revision: Number(lockedRow.revision_no),
          messageNo: Number(duplicate.rows[0].message_no),
        };
      }
      if (Number(lockedRow.revision_no) !== input.revision_no) {
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '草稿已更新，请刷新后重试',
          409,
          true,
        );
      }
      const sequence = await client.query<Record<string, unknown>>(
        `select coalesce(max(message_no), 0) as last_message_no
           from skill_guided_creation_messages
          where session_id = $1`,
        [input.session_id],
      );
      const messageNo = Number(sequence.rows[0]?.last_message_no ?? 0) + 1;
      await client.query(
        `insert into skill_guided_creation_messages (
           session_id, message_no, client_message_id, role, content, metadata_json
         ) values ($1, $2, $3, 'user', $4, '{}'::jsonb)`,
        [input.session_id, messageNo, clientMessageId, content],
      );
      const updated = await client.query(
        `update skill_guided_creation_sessions
            set status = 'collecting',
                confirmation_json = null,
                error_json = null,
                revision_no = revision_no + 1,
                updated_at = now()
          where id = $1 and user_id = $2 and revision_no = $3`,
        [input.session_id, input.auth_user_id, input.revision_no],
      );
      if (updated.rowCount !== 1) {
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '草稿已更新，请刷新后重试',
          409,
          true,
        );
      }
      return {
        inserted: true,
        revision: input.revision_no + 1,
        messageNo,
      };
    });
    if (!accepted.inserted) {
      return processGuidedCreationMessage(input);
    }
    acceptedRevision = accepted.revision;
    userMessageNo = accepted.messageNo;
  }

  let turn: GuidedAssistantTurn;
  try {
    turn = await generateAssistantTurn({ session, content });
  } catch (error) {
    await query(
      `update skill_guided_creation_sessions
          set status = 'failed',
              error_json = $4::jsonb,
              updated_at = now()
        where id = $1
          and user_id = $2
          and revision_no = $3
          and status = 'collecting'`,
      [
        input.session_id,
        input.auth_user_id,
        acceptedRevision,
        JSON.stringify({
          code: 'GUIDED_ASSISTANT_FAILED',
          message: '需求理解失败，请重试',
          retryable: true,
        }),
      ],
    );
    if (error instanceof GuidedCreationError) throw error;
    throw new GuidedCreationError(
      'GUIDED_ASSISTANT_FAILED',
      '需求理解失败，请重试',
      500,
      true,
    );
  }

  await withTransaction(async (client) => {
    const locked = await client.query<Record<string, unknown>>(
      `select revision_no, status
         from skill_guided_creation_sessions
        where id = $1 and user_id = $2
        for update`,
      [input.session_id, input.auth_user_id],
    );
    const lockedRow = locked.rows[0];
    if (
      !lockedRow ||
      Number(lockedRow.revision_no) !== acceptedRevision ||
      lockedRow.status !== 'collecting'
    ) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
    await client.query(
      `insert into skill_guided_creation_messages (
         session_id, message_no, role, content, metadata_json
       ) values ($1, $2, 'assistant', $3, $4::jsonb)`,
      [
        input.session_id,
        userMessageNo + 1,
        turn.content,
        JSON.stringify({
          reply_to_client_message_id: clientMessageId,
          next_blocking_field: turn.next_blocking_field,
          suggested_options: turn.suggested_options,
          confirmation: turn.confirmation,
        }),
      ],
    );
    const updated = await client.query(
      `update skill_guided_creation_sessions
          set status = $3,
              draft_json = $4::jsonb,
              field_states_json = $5::jsonb,
              confirmation_json = $6::jsonb,
              error_json = null,
              updated_at = now()
        where id = $1 and user_id = $2 and revision_no = $7`,
      [
        input.session_id,
        input.auth_user_id,
        turn.status,
        JSON.stringify(turn.draft),
        JSON.stringify(turn.field_states),
        turn.confirmation ? JSON.stringify(turn.confirmation) : null,
        acceptedRevision,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
  });

  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}

export async function startGuidedCreation(input: {
  auth_user_id: string;
  content: string;
  client_message_id: string;
  model?: string;
  documents?: GuidedCreationDocument[];
}): Promise<GuidedCreationSessionDetail> {
  const documents = normalizeDocuments(input.documents);
  const content = normalizeMessage(input.content);
  const clientMessageId = normalizeClientMessageId(input.client_message_id);
  const result = await query<Record<string, unknown>>(
    `insert into skill_guided_creation_sessions (
       user_id, model, documents_json, start_client_message_id
     ) values ($1, $2, $3::jsonb, $4)
     on conflict (user_id, start_client_message_id)
       where start_client_message_id is not null
     do nothing
     returning *`,
    [
      input.auth_user_id,
      input.model?.trim() || null,
      JSON.stringify(documents),
      clientMessageId,
    ],
  );
  let sessionId = String(result.rows[0]?.id ?? '');
  if (!sessionId) {
    const existing = await query<Record<string, unknown>>(
      `select id
         from skill_guided_creation_sessions
        where user_id = $1 and start_client_message_id = $2`,
      [input.auth_user_id, clientMessageId],
    );
    sessionId = String(existing.rows[0]?.id ?? '');
  }
  if (!sessionId) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_CREATE_FAILED',
      '创建 Skill 草稿失败',
      500,
      true,
    );
  }
  return processGuidedCreationMessage({
    auth_user_id: input.auth_user_id,
    session_id: sessionId,
    client_message_id: clientMessageId,
    revision_no: 0,
    content,
  });
}

export async function cancelGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
}): Promise<GuidedCreationSessionDetail> {
  const result = await query(
    `update skill_guided_creation_sessions
        set status = 'cancelled',
            revision_no = revision_no + 1,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and status in ('collecting', 'ready_for_confirmation', 'failed')`,
    [input.session_id, input.auth_user_id, input.revision_no],
  );
  if (result.rowCount !== 1) {
    const current = await getGuidedCreationDetail({
      auth_user_id: input.auth_user_id,
      session_id: input.session_id,
    });
    if (current.status === 'cancelled') return current;
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '草稿已更新，请刷新后重试',
      409,
      true,
    );
  }
  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}

export function buildGuidedGenerationInstruction(
  draft: GuidedSkillDraft,
): string {
  const lines = GUIDED_DRAFT_FIELDS.map(
    (field) => `- ${field}: ${draft[field] ?? ''}`,
  );
  return [
    '请创建一个教育场景使用的 Skill。',
    '只生成 1 个 Skill，不要拆分成多个 Skill。',
    'Package 和 agent.md 仅作为内部运行容器，用户看到和使用的主体必须是这个 Skill。',
    '请严格遵守以下已确认需求：',
    ...lines,
  ].join('\n');
}

async function markFinalizationFailed(input: {
  auth_user_id: string;
  session_id: string;
  request_id: string;
  snapshot: AgentPackageSnapshot | null;
  error: unknown;
}) {
  const code =
    input.error instanceof GuidedCreationError
      ? input.error.code
      : 'SKILL_GENERATION_FAILED';
  const message =
    input.error instanceof GuidedCreationError
      ? input.error.message
      : 'Skill 生成或保存失败，请重试';
  try {
    await query(
      `update skill_guided_creation_sessions
          set status = 'failed',
              generated_snapshot_json = $4::jsonb,
              validation_result_json = $5::jsonb,
              error_json = $6::jsonb,
              updated_at = now()
        where id = $1
          and user_id = $2
          and status = 'finalizing'
          and finalize_request_id = $3`,
      [
        input.session_id,
        input.auth_user_id,
        input.request_id,
        input.snapshot ? JSON.stringify(input.snapshot) : null,
        JSON.stringify({ valid: false }),
        JSON.stringify({ code, message, retryable: true }),
      ],
    );
  } catch {
    // Preserve the original generation or transaction error.
  }
}

export async function confirmGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
  request_id: string;
  on_phase?: (
    phase: 'generating' | 'validating' | 'saving',
  ) => void;
  on_preview?: (preview: {
    type: string;
    name: string;
    content: string;
  }) => void;
}): Promise<GuidedCreationSessionDetail> {
  if (
    typeof input.request_id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.request_id)
  ) {
    throw new GuidedCreationError(
      'INVALID_FINALIZE_REQUEST_ID',
      'request_id 格式不正确',
      400,
    );
  }
  const session = await getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
  if (session.status === 'completed') return session;
  if (session.revision_no !== input.revision_no) {
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '草稿已更新，请刷新后重试',
      409,
      true,
    );
  }
  if (session.status === 'finalizing') {
    const leaseAge = Date.now() - new Date(session.updated_at).getTime();
    if (leaseAge < GUIDED_FINALIZE_LEASE_MS) {
      throw new GuidedCreationError(
        'FINALIZATION_IN_PROGRESS',
        'Skill 正在生成中',
        409,
        true,
      );
    }
  } else if (
    session.status !== 'ready_for_confirmation' &&
    session.status !== 'failed'
  ) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_NOT_READY',
      '请先完成需求确认',
      409,
    );
  }

  const claimed = await query(
    `update skill_guided_creation_sessions
        set status = 'finalizing',
            finalize_request_id = $4,
            error_json = null,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and (
          status in ('ready_for_confirmation', 'failed')
          or (status = 'finalizing' and updated_at < now() - interval '10 minutes')
        )`,
    [
      input.session_id,
      input.auth_user_id,
      input.revision_no,
      input.request_id,
    ],
  );
  if (claimed.rowCount !== 1) {
    throw new GuidedCreationError(
      'FINALIZATION_IN_PROGRESS',
      'Skill 正在生成中',
      409,
      true,
    );
  }

  let snapshot: AgentPackageSnapshot | null = null;
  try {
    input.on_phase?.('generating');
    snapshot = await buildGeneratedPackageSnapshot({
      instruction: buildGuidedGenerationInstruction(session.draft),
      model: session.model ?? undefined,
      documents: session.documents.map((document) => ({
        name: document.name,
        content: document.content,
      })),
      max_skills: 1,
      onPreview: input.on_preview,
    });
    input.on_phase?.('validating');
    if (snapshot.skills.length !== 1) {
      throw new GuidedCreationError(
        'INVALID_GENERATED_SKILL_COUNT',
        '生成结果必须且只能包含一个 Skill',
        422,
        true,
      );
    }

    input.on_phase?.('saving');
    await withTransaction(async (client) => {
      const locked = await client.query<Record<string, unknown>>(
        `select id
           from skill_guided_creation_sessions
          where id = $1
            and user_id = $2
            and status = 'finalizing'
            and finalize_request_id = $3
            and revision_no = $4
          for update`,
        [
          input.session_id,
          input.auth_user_id,
          input.request_id,
          input.revision_no,
        ],
      );
      if (!locked.rows[0]) {
        throw new GuidedCreationError(
          'FINALIZATION_LEASE_LOST',
          '生成任务状态已变化，请刷新后重试',
          409,
          true,
        );
      }
      const created = await createPackageWithSnapshotTx(
        client,
        input.auth_user_id,
        snapshot!,
        'generated',
      );
      const mapping = await client.query<Record<string, unknown>>(
        `select skill_id, skill_version_id
           from agent_package_version_skills
          where package_version_id = $1 and package_id = $2
          order by sort_order asc
          limit 1`,
        [created.packageVersionId, created.packageId],
      );
      const skillId = mapping.rows[0]?.skill_id;
      const skillVersionId = mapping.rows[0]?.skill_version_id;
      if (!skillId || !skillVersionId) {
        throw new GuidedCreationError(
          'SKILL_VERSION_PERSIST_FAILED',
          'Skill 版本保存失败',
          500,
          true,
        );
      }
      const completed = await client.query(
        `update skill_guided_creation_sessions
            set status = 'completed',
                generated_snapshot_json = $5::jsonb,
                validation_result_json = $6::jsonb,
                package_id = $7,
                skill_id = $8,
                skill_version_id = $9,
                error_json = null,
                completed_at = now(),
                updated_at = now()
          where id = $1
            and user_id = $2
            and finalize_request_id = $3
            and revision_no = $4
            and status = 'finalizing'`,
        [
          input.session_id,
          input.auth_user_id,
          input.request_id,
          input.revision_no,
          JSON.stringify(snapshot),
          JSON.stringify({ valid: true, skill_count: 1 }),
          created.packageId,
          skillId,
          skillVersionId,
        ],
      );
      if (completed.rowCount !== 1) {
        throw new GuidedCreationError(
          'FINALIZATION_LEASE_LOST',
          '生成任务状态已变化，请刷新后重试',
          409,
          true,
        );
      }
    });
  } catch (error) {
    await markFinalizationFailed({
      auth_user_id: input.auth_user_id,
      session_id: input.session_id,
      request_id: input.request_id,
      snapshot,
      error,
    });
    if (error instanceof GuidedCreationError) throw error;
    throw new GuidedCreationError(
      'SKILL_GENERATION_FAILED',
      'Skill 生成或保存失败，请重试',
      500,
      true,
    );
  }

  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}
