import type { Response } from 'express';
import type {
  GuidedCreationAction,
  GuidedCreationDocument,
  GuidedCreationStatus,
} from '@educlaw/shared';
import {
  cancelGuidedCreation,
  confirmGuidedCreation,
  deleteGuidedCreation,
  getGuidedCreationDetail,
  GuidedCreationError,
  listGuidedCreations,
  processGuidedCreationMessage,
  renameGuidedCreation,
  startGuidedCreation,
} from '../services/guided-creation-service.js';
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from '../utils/sse.js';

const ACTIONS = new Set<GuidedCreationAction>([
  'SkillGuidedCreationStart',
  'SkillGuidedCreationList',
  'SkillGuidedCreationDetail',
  'SkillGuidedCreationMessage',
  'SkillGuidedCreationConfirm',
  'SkillGuidedCreationCancel',
  'SkillGuidedCreationRename',
  'SkillGuidedCreationDelete',
]);
const STREAM_ACTIONS = new Set<GuidedCreationAction>([
  'SkillGuidedCreationStart',
  'SkillGuidedCreationMessage',
  'SkillGuidedCreationConfirm',
]);
const STATUSES = new Set<GuidedCreationStatus>([
  'collecting',
  'ready_for_confirmation',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
]);

export interface ParsedGuidedCreationRequest {
  action: GuidedCreationAction;
  payload: Record<string, unknown>;
}

function invalid(message: string): never {
  throw new GuidedCreationError(
    'INVALID_GUIDED_REQUEST',
    message,
    422,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) {
    invalid(`${label} 含有未支持的字段`);
  }
}

function positiveId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    invalid(`${name} 必须是正整数字符串`);
  }
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid('revision_no 必须是非负整数');
  }
  return value;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max
  ) {
    invalid(`${name} 格式不正确`);
  }
  return value.trim();
}

function optionalText(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, name, max);
}

function requestId(value: unknown, name: string): string {
  const text = requiredText(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(text)) {
    invalid(`${name} 格式不正确`);
  }
  return text;
}

function parseDocuments(value: unknown): GuidedCreationDocument[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) {
    invalid('documents 格式不正确');
  }
  return value.map((item) => {
    if (!isRecord(item)) invalid('documents 格式不正确');
    exactKeys(item, ['name', 'content', 'mime_type'], 'document');
    return {
      name: requiredText(item.name, 'document.name', 200),
      content: requiredText(item.content, 'document.content', 12_000),
      ...(item.mime_type !== undefined
        ? { mime_type: requiredText(item.mime_type, 'document.mime_type', 100) }
        : {}),
    };
  });
}

export function isGuidedCreationAction(
  value: unknown,
): value is GuidedCreationAction {
  return typeof value === 'string' && ACTIONS.has(value as GuidedCreationAction);
}

export function isGuidedCreationStreamAction(
  value: GuidedCreationAction,
): boolean {
  return STREAM_ACTIONS.has(value);
}

export function parseGuidedCreationRequest(
  body: unknown,
): ParsedGuidedCreationRequest {
  if (!isRecord(body) || !isGuidedCreationAction(body.action)) {
    invalid('action 不正确');
  }
  exactKeys(body, ['action', 'payload'], 'body');
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isRecord(payload)) invalid('payload 必须是对象');

  switch (body.action) {
    case 'SkillGuidedCreationStart': {
      exactKeys(
        payload,
        ['content', 'client_message_id', 'model', 'documents'],
        'payload',
      );
      return {
        action: body.action,
        payload: {
          content: requiredText(payload.content, 'content', 12_000),
          client_message_id: requestId(
            payload.client_message_id,
            'client_message_id',
          ),
          model: optionalText(payload.model, 'model', 120),
          documents: parseDocuments(payload.documents),
        },
      };
    }
    case 'SkillGuidedCreationMessage': {
      exactKeys(
        payload,
        ['session_id', 'client_message_id', 'revision_no', 'content'],
        'payload',
      );
      return {
        action: body.action,
        payload: {
          session_id: positiveId(payload.session_id, 'session_id'),
          client_message_id: requestId(
            payload.client_message_id,
            'client_message_id',
          ),
          revision_no: revision(payload.revision_no),
          content: requiredText(payload.content, 'content', 12_000),
        },
      };
    }
    case 'SkillGuidedCreationConfirm': {
      exactKeys(
        payload,
        ['session_id', 'revision_no', 'request_id'],
        'payload',
      );
      return {
        action: body.action,
        payload: {
          session_id: positiveId(payload.session_id, 'session_id'),
          revision_no: revision(payload.revision_no),
          request_id: requestId(payload.request_id, 'request_id'),
        },
      };
    }
    case 'SkillGuidedCreationDetail': {
      exactKeys(payload, ['session_id'], 'payload');
      return {
        action: body.action,
        payload: { session_id: positiveId(payload.session_id, 'session_id') },
      };
    }
    case 'SkillGuidedCreationCancel': {
      exactKeys(payload, ['session_id', 'revision_no'], 'payload');
      return {
        action: body.action,
        payload: {
          session_id: positiveId(payload.session_id, 'session_id'),
          revision_no: revision(payload.revision_no),
        },
      };
    }
    case 'SkillGuidedCreationRename': {
      exactKeys(
        payload,
        ['session_id', 'revision_no', 'display_name'],
        'payload',
      );
      return {
        action: body.action,
        payload: {
          session_id: positiveId(payload.session_id, 'session_id'),
          revision_no: revision(payload.revision_no),
          display_name: requiredText(payload.display_name, 'display_name', 200),
        },
      };
    }
    case 'SkillGuidedCreationDelete': {
      exactKeys(payload, ['session_id', 'revision_no'], 'payload');
      return {
        action: body.action,
        payload: {
          session_id: positiveId(payload.session_id, 'session_id'),
          revision_no: revision(payload.revision_no),
        },
      };
    }
    case 'SkillGuidedCreationList': {
      exactKeys(payload, ['status', 'limit', 'cursor'], 'payload');
      let status: GuidedCreationStatus[] | undefined;
      if (payload.status !== undefined) {
        if (
          !Array.isArray(payload.status) ||
          payload.status.some(
            (item) => typeof item !== 'string' || !STATUSES.has(item as GuidedCreationStatus),
          )
        ) {
          invalid('status 格式不正确');
        }
        status = payload.status as GuidedCreationStatus[];
      }
      let limit: number | undefined;
      if (payload.limit !== undefined) {
        if (
          typeof payload.limit !== 'number' ||
          !Number.isInteger(payload.limit) ||
          payload.limit < 1 ||
          payload.limit > 100
        ) {
          invalid('limit 必须是 1 到 100 的整数');
        }
        limit = payload.limit;
      }
      return {
        action: body.action,
        payload: {
          status,
          limit,
          cursor: optionalText(payload.cursor, 'cursor', 80),
        },
      };
    }
  }
}

export async function handleGuidedCreationJsonAction(input: {
  auth_user_id: string;
  request: ParsedGuidedCreationRequest;
}) {
  const payload = input.request.payload;
  switch (input.request.action) {
    case 'SkillGuidedCreationList':
      return listGuidedCreations({
        auth_user_id: input.auth_user_id,
        status: payload.status as GuidedCreationStatus[] | undefined,
        limit: payload.limit as number | undefined,
        cursor: payload.cursor as string | undefined,
      });
    case 'SkillGuidedCreationDetail':
      return getGuidedCreationDetail({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
      });
    case 'SkillGuidedCreationCancel':
      return cancelGuidedCreation({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
        revision_no: payload.revision_no as number,
      });
    case 'SkillGuidedCreationRename':
      return renameGuidedCreation({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
        revision_no: payload.revision_no as number,
        display_name: payload.display_name as string,
      });
    case 'SkillGuidedCreationDelete':
      return deleteGuidedCreation({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
        revision_no: payload.revision_no as number,
      });
    default:
      invalid('该 action 必须使用 SSE');
  }
}

function lastAssistantMessage(
  detail: Awaited<ReturnType<typeof getGuidedCreationDetail>>,
) {
  return [...detail.messages].reverse().find((message) => message.role === 'assistant');
}

export async function handleGuidedCreationStreamAction(input: {
  auth_user_id: string;
  request: ParsedGuidedCreationRequest;
  response: Response;
}) {
  initSse(input.response);
  const heartbeat = startSseHeartbeat(input.response, 15_000);
  const payload = input.request.payload;
  try {
    let detail;
    if (input.request.action === 'SkillGuidedCreationStart') {
      writeSseEvent(input.response, 'phase', { phase: 'understanding' });
      detail = await startGuidedCreation({
        auth_user_id: input.auth_user_id,
        content: payload.content as string,
        client_message_id: payload.client_message_id as string,
        model: payload.model as string | undefined,
        documents: payload.documents as GuidedCreationDocument[] | undefined,
      });
    } else if (input.request.action === 'SkillGuidedCreationMessage') {
      writeSseEvent(input.response, 'phase', { phase: 'understanding' });
      detail = await processGuidedCreationMessage({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
        client_message_id: payload.client_message_id as string,
        revision_no: payload.revision_no as number,
        content: payload.content as string,
      });
    } else if (input.request.action === 'SkillGuidedCreationConfirm') {
      detail = await confirmGuidedCreation({
        auth_user_id: input.auth_user_id,
        session_id: payload.session_id as string,
        revision_no: payload.revision_no as number,
        request_id: payload.request_id as string,
        on_phase: (phase) => writeSseEvent(input.response, 'phase', { phase }),
        on_preview: (preview) =>
          writeSseEvent(input.response, 'preview', {
            files: [
              {
                path: preview.name,
                content: preview.content,
              },
            ],
          }),
      });
    } else {
      invalid('该 action 不支持 SSE');
    }

    const assistantMessage = lastAssistantMessage(detail);
    if (assistantMessage) {
      writeSseEvent(input.response, 'message', { message: assistantMessage });
    }
    if (detail.status === 'ready_for_confirmation') {
      writeSseEvent(input.response, 'confirmation', { session: detail });
    }
    writeSseEvent(input.response, 'done', { session: detail });
    writeSseEvent(input.response, 'stream_end', {});
  } catch (error) {
    const guidedError =
      error instanceof GuidedCreationError
        ? error
        : new GuidedCreationError(
            'GUIDED_REQUEST_FAILED',
            '请求处理失败，请重试',
            500,
            true,
          );
    writeSseEvent(input.response, 'error', {
      code: guidedError.code,
      message: guidedError.message,
      retryable: guidedError.retryable,
    });
    writeSseEvent(input.response, 'stream_end', {});
  } finally {
    stopSseHeartbeat(heartbeat);
    input.response.end();
  }
}
