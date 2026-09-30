import type { Response } from 'express';
import type {
  GuidedCreationAction,
  GuidedCreationDocument,
  GuidedCreationStatus,
  MultimodalCandidatePasses,
  MultimodalEvidence,
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
import { createMultimodalGuidedCreationService } from '../services/multimodal-guided-creation-service.js';
import { createMultimodalProgressStreamService } from '../services/multimodal-progress-stream-service.js';
import { createMediaUrlImportService } from '../services/media-url-import.service.js';
import { createMultimodalReleaseService } from '../services/multimodal-release-service.js';
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from '../utils/sse.js';

type MediaGuidedCreationAction =
  | 'skill.media.session.create'
  | 'skill.media.session.list'
  | 'skill.media.session.detail'
  | 'skill.media.asset.preview'
  | 'skill.media.upload.intent'
  | 'skill.media.upload.confirm'
  | 'skill.media.url.import'
  | 'skill.media.process.start'
  | 'skill.media.retry'
  | 'skill.media.cancel'
  | 'skill.media.session.delete'
  | 'skill.media.progress'
  | 'skill.media.progress.stream'
  | 'skill.media.transcript.update'
  | 'skill.media.evidence.update'
  | 'skill.media.candidate.update'
  | 'skill.media.overview.confirm'
  | 'skill.media.candidate.confirm'
  | 'skill.media.test.start'
  | 'skill.media.generate.confirm'
  | 'skill.media.publish';

type GuidedCreationApiAction = GuidedCreationAction | MediaGuidedCreationAction;
type GuidedCreationStreamAction =
  | GuidedCreationAction
  | 'skill.media.progress.stream';

const ACTIONS = new Set<GuidedCreationApiAction>([
  'SkillGuidedCreationStart',
  'SkillGuidedCreationList',
  'SkillGuidedCreationDetail',
  'SkillGuidedCreationMessage',
  'SkillGuidedCreationConfirm',
  'SkillGuidedCreationCancel',
  'SkillGuidedCreationRename',
  'SkillGuidedCreationDelete',
  'skill.media.session.create',
  'skill.media.session.list',
  'skill.media.session.detail',
  'skill.media.asset.preview',
  'skill.media.upload.intent',
  'skill.media.upload.confirm',
  'skill.media.url.import',
  'skill.media.process.start',
  'skill.media.retry',
  'skill.media.cancel',
  'skill.media.session.delete',
  'skill.media.progress',
  'skill.media.progress.stream',
  'skill.media.transcript.update',
  'skill.media.evidence.update',
  'skill.media.candidate.update',
  'skill.media.overview.confirm',
  'skill.media.candidate.confirm',
  'skill.media.test.start',
  'skill.media.generate.confirm',
  'skill.media.publish',
]);
const STREAM_ACTIONS = new Set<GuidedCreationStreamAction>([
  'SkillGuidedCreationStart',
  'SkillGuidedCreationMessage',
  'SkillGuidedCreationConfirm',
  'skill.media.progress.stream',
]);
const STATUSES = new Set<GuidedCreationStatus>([
  'collecting',
  'ready_for_confirmation',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
]);

function getMultimodalGuidedCreationService() {
  return createMultimodalGuidedCreationService();
}

function getMultimodalProgressStreamService() {
  return createMultimodalProgressStreamService();
}

function getMediaUrlImportService() {
  return createMediaUrlImportService();
}

function getMultimodalReleaseService() {
  return createMultimodalReleaseService();
}

export interface ParsedGuidedCreationRequest {
  action: GuidedCreationApiAction;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  sessionId?: string;
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

function candidateId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    invalid(`${name} 格式不正确`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    invalid(`${name} 格式不正确`);
  }
  return value;
}

function reviewNotes(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > 2_000) {
    invalid(`${name} 格式不正确`);
  }
  return value;
}

function candidateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    invalid('selectedCandidateIds 格式不正确');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      invalid('selectedCandidateIds 格式不正确');
    }
  }
  const ids = value.map((item, index) =>
    candidateId(item, `selectedCandidateIds[${index}]`)
  );
  if (new Set(ids).size !== ids.length) {
    invalid('selectedCandidateIds 不能重复');
  }
  return ids;
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, 'cursor', 120);
}

function limitValue(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    invalid('limit 必须是 1 到 100 的整数');
  }
  return value;
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
): value is GuidedCreationApiAction {
  return typeof value === 'string' && ACTIONS.has(value as GuidedCreationApiAction);
}

export function isGuidedCreationStreamAction(
  value: GuidedCreationApiAction,
): boolean {
  return STREAM_ACTIONS.has(value as GuidedCreationStreamAction);
}

export function parseGuidedCreationRequest(
  body: unknown,
): ParsedGuidedCreationRequest {
  if (!isRecord(body) || !isGuidedCreationAction(body.action)) {
    invalid('action 不正确');
  }
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isRecord(payload)) invalid('payload 必须是对象');

  switch (body.action) {
    case 'skill.media.session.create': {
      exactKeys(body, ['action', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['displayName'], 'payload');
      return {
        action: body.action,
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          displayName: requiredText(payload.displayName, 'displayName', 200),
        },
      };
    }
    case 'skill.media.session.list': {
      exactKeys(body, ['action', 'payload'], 'body');
      exactKeys(payload, ['limit', 'cursor'], 'payload');
      return {
        action: body.action,
        payload: {
          limit: limitValue(payload.limit),
          cursor: optionalCursor(payload.cursor),
        },
      };
    }
    case 'skill.media.upload.intent': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['fileName', 'declaredMimeType', 'sizeBytes'], 'payload');
      if (
        typeof payload.sizeBytes !== 'number' ||
        !Number.isInteger(payload.sizeBytes) ||
        payload.sizeBytes < 1
      ) {
        invalid('sizeBytes 必须是正整数');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          fileName: requiredText(payload.fileName, 'fileName', 255),
          declaredMimeType: requiredText(
            payload.declaredMimeType,
            'declaredMimeType',
            255,
          ),
          sizeBytes: payload.sizeBytes,
        },
      };
    }
    case 'skill.media.url.import': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['url', 'rightsConfirmed'], 'payload');
      if (payload.rightsConfirmed !== true) {
        invalid('rightsConfirmed 必须明确为 true');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          url: requiredText(payload.url, 'url', 2_048),
          rightsConfirmed: true,
        },
      };
    }
    case 'skill.media.upload.confirm': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['uploadToken', 'expectedRevisionNo', 'parts'], 'payload');

      if (
        typeof payload.expectedRevisionNo !== 'number' ||
        !Number.isInteger(payload.expectedRevisionNo) ||
        payload.expectedRevisionNo < 0
      ) {
        invalid('expectedRevisionNo 必须是非负整数');
      }

      let parts: Array<{ partNumber: number; etag: string }> | undefined;
      if (payload.parts !== undefined) {
        if (!Array.isArray(payload.parts)) {
          invalid('parts 必须是数组');
        }
        parts = payload.parts.map((part, index) => {
          if (!isRecord(part)) {
            invalid(`parts[${index}] 必须是对象`);
          }
          exactKeys(part, ['partNumber', 'etag'], `parts[${index}]`);
          if (
            typeof part.partNumber !== 'number' ||
            !Number.isInteger(part.partNumber) ||
            part.partNumber < 1
          ) {
            invalid(`parts[${index}].partNumber 必须是正整数`);
          }
          return {
            partNumber: part.partNumber,
            etag: requiredText(part.etag, `parts[${index}].etag`, 512).trim(),
          };
        });
      }

      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          uploadToken: requiredText(payload.uploadToken, 'uploadToken', 2048),
          expectedRevisionNo: payload.expectedRevisionNo,
          parts,
        },
      };
    }
    case 'skill.media.process.start': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(
        payload,
        ['expectedRevisionNo', 'understandingMode', 'transcriptionMode'],
        'payload',
      );
      const understandingModes = new Set(['auto', 'nativeVideo', 'compatible']);
      if (
        typeof payload.understandingMode !== 'string' ||
        !understandingModes.has(payload.understandingMode)
      ) {
        invalid('understandingMode 不正确');
      }
      if (payload.transcriptionMode !== 'deploymentDefault') {
        invalid('transcriptionMode 不正确');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          understandingMode: payload.understandingMode,
          transcriptionMode: 'deploymentDefault',
        },
      };
    }
    case 'skill.media.retry': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo', 'failedJobId'], 'payload');
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          ...(payload.failedJobId === undefined
            ? {}
            : { failedJobId: positiveId(payload.failedJobId, 'failedJobId') }),
        },
      };
    }
    case 'skill.media.cancel':
    case 'skill.media.session.delete': {
      exactKeys(body, ['action', 'sessionId', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo'], 'payload');
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
        },
      };
    }
    case 'skill.media.session.detail':
    case 'skill.media.progress.stream':
    case 'skill.media.progress': {
      exactKeys(body, ['action', 'payload'], 'body');
      exactKeys(payload, ['sessionId'], 'payload');
      return {
        action: body.action,
        payload: {
          sessionId: positiveId(payload.sessionId, 'sessionId'),
        },
      };
    }
    case 'skill.media.asset.preview': {
      exactKeys(body, ['action', 'payload'], 'body');
      exactKeys(payload, ['sessionId', 'objectKey'], 'payload');
      return {
        action: body.action,
        payload: {
          sessionId: positiveId(payload.sessionId, 'sessionId'),
          objectKey: requiredText(payload.objectKey, 'objectKey', 1_024),
        },
      };
    }
    case 'skill.media.transcript.update': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(
        payload,
        [
          'expectedRevisionNo',
          'segmentIndex',
          'expectedSegmentRevisionNo',
          'text',
          'speaker',
        ],
        'payload',
      );
      if (
        typeof payload.segmentIndex !== 'number' ||
        !Number.isSafeInteger(payload.segmentIndex) ||
        payload.segmentIndex < 0 ||
        typeof payload.expectedSegmentRevisionNo !== 'number' ||
        !Number.isSafeInteger(payload.expectedSegmentRevisionNo) ||
        payload.expectedSegmentRevisionNo < 0
      ) {
        invalid('segmentIndex 和 expectedSegmentRevisionNo 必须是非负整数');
      }
      if (
        payload.speaker !== null &&
        (typeof payload.speaker !== 'string' || !payload.speaker.trim())
      ) {
        invalid('speaker 必须是非空字符串或 null');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          segmentIndex: payload.segmentIndex,
          expectedSegmentRevisionNo: payload.expectedSegmentRevisionNo,
          text: requiredText(payload.text, 'text', 16_384),
          speaker:
            payload.speaker === null
              ? null
              : requiredText(payload.speaker, 'speaker', 256),
        },
      };
    }
    case 'skill.media.evidence.update': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo', 'evidenceItems'], 'payload');
      if (
        !Array.isArray(payload.evidenceItems) ||
        payload.evidenceItems.length < 1 ||
        payload.evidenceItems.length > 512
      ) {
        invalid('evidenceItems 必须是 1 到 512 条证据');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          evidenceItems: payload.evidenceItems,
        },
      };
    }
    case 'skill.media.candidate.update': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo', 'candidatePasses'], 'payload');
      if (!isRecord(payload.candidatePasses)) {
        invalid('candidatePasses 必须是对象');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          candidatePasses: payload.candidatePasses,
        },
      };
    }
    case 'skill.media.overview.confirm': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo', 'overview'], 'payload');
      if (!isRecord(payload.overview)) {
        invalid('overview 必须是对象');
      }
      exactKeys(payload.overview, ['title', 'approved', 'userNotes'], 'overview');
      if (payload.overview.approved !== true) {
        invalid('overview.approved 必须为 true');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          overview: {
            title: requiredText(payload.overview.title, 'title', 200),
            approved: true,
            userNotes: reviewNotes(payload.overview.userNotes, 'userNotes'),
          },
        },
      };
    }
    case 'skill.media.candidate.confirm': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo', 'selectedCandidateIds'], 'payload');
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          selectedCandidateIds: candidateIds(payload.selectedCandidateIds),
        },
      };
    }
    case 'skill.media.test.start': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(payload, ['expectedRevisionNo'], 'payload');
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: { expectedRevisionNo: revision(payload.expectedRevisionNo) },
      };
    }
    case 'skill.media.generate.confirm':
    case 'skill.media.publish': {
      exactKeys(body, ['action', 'sessionId', 'idempotencyKey', 'payload'], 'body');
      exactKeys(
        payload,
        ['expectedRevisionNo', 'targetPackageId', 'expectedPackageVersionId'],
        'payload',
      );
      const targetPackageId =
        payload.targetPackageId === null
          ? null
          : positiveId(payload.targetPackageId, 'targetPackageId');
      const expectedPackageVersionId =
        payload.expectedPackageVersionId === null
          ? null
          : positiveId(payload.expectedPackageVersionId, 'expectedPackageVersionId');
      if ((targetPackageId === null) !== (expectedPackageVersionId === null)) {
        invalid('targetPackageId 与 expectedPackageVersionId 必须同时提供或同时为 null');
      }
      return {
        action: body.action,
        sessionId: positiveId(body.sessionId, 'sessionId'),
        idempotencyKey: requestId(body.idempotencyKey, 'idempotencyKey'),
        payload: {
          expectedRevisionNo: revision(payload.expectedRevisionNo),
          targetPackageId,
          expectedPackageVersionId,
        },
      };
    }
    case 'SkillGuidedCreationStart': {
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
      exactKeys(payload, ['session_id'], 'payload');
      return {
        action: body.action,
        payload: { session_id: positiveId(payload.session_id, 'session_id') },
      };
    }
    case 'SkillGuidedCreationCancel': {
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
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
      exactKeys(body, ['action', 'payload'], 'body');
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
    case 'skill.media.session.create':
      return getMultimodalGuidedCreationService().createSession({
        authUserId: input.auth_user_id,
        idempotencyKey: input.request.idempotencyKey ?? '',
        displayName: String(payload.displayName ?? ''),
      });
    case 'skill.media.upload.intent':
      return getMultimodalGuidedCreationService().createUploadIntent({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        fileName: String(payload.fileName ?? ''),
        declaredMimeType: String(payload.declaredMimeType ?? ''),
        sizeBytes: payload.sizeBytes as number,
      });
    case 'skill.media.upload.confirm':
      return getMultimodalGuidedCreationService().createUploadConfirm({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        uploadToken: String(payload.uploadToken ?? ''),
        expectedRevisionNo: payload.expectedRevisionNo as number,
        parts: payload.parts as Array<{ partNumber: number; etag: string }> | undefined,
      });
    case 'skill.media.url.import':
      return getMediaUrlImportService().importToSession({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        sourceUrl: String(payload.url ?? ''),
      });
    case 'skill.media.process.start':
      return getMultimodalGuidedCreationService().startProcessing({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        understandingMode: payload.understandingMode as
          | 'auto'
          | 'nativeVideo'
          | 'compatible',
        transcriptionMode: payload.transcriptionMode as 'deploymentDefault',
      });
    case 'skill.media.retry':
      return getMultimodalGuidedCreationService().retryProcessing({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        failedJobId:
          payload.failedJobId === undefined
            ? undefined
            : String(payload.failedJobId),
      });
    case 'skill.media.cancel':
      return getMultimodalGuidedCreationService().cancelProcessing({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
      });
    case 'skill.media.session.delete':
      return getMultimodalGuidedCreationService().deleteSession({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
      });
    case 'skill.media.session.list':
      return getMultimodalGuidedCreationService().listSessions({
        authUserId: input.auth_user_id,
        limit: payload.limit as number | undefined,
        cursor: payload.cursor as string | undefined,
      });
    case 'skill.media.session.detail':
      return getMultimodalGuidedCreationService().getSessionDetail({
        authUserId: input.auth_user_id,
        sessionId: String(payload.sessionId ?? ''),
      });
    case 'skill.media.asset.preview':
      return getMultimodalGuidedCreationService().createAssetPreview({
        authUserId: input.auth_user_id,
        sessionId: String(payload.sessionId ?? ''),
        objectKey: String(payload.objectKey ?? ''),
      });
    case 'skill.media.progress':
      return getMultimodalGuidedCreationService().getSessionProgress({
        authUserId: input.auth_user_id,
        sessionId: String(payload.sessionId ?? ''),
      });
    case 'skill.media.transcript.update':
      return getMultimodalGuidedCreationService().updateTranscriptSegment({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        mutation: {
          segmentIndex: payload.segmentIndex as number,
          expectedSegmentRevisionNo: payload.expectedSegmentRevisionNo as number,
          text: payload.text as string,
          speaker: payload.speaker as string | null,
        },
      });
    case 'skill.media.evidence.update':
      return getMultimodalGuidedCreationService().updateEvidence({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        evidenceItems: payload.evidenceItems as MultimodalEvidence[],
      });
    case 'skill.media.candidate.update':
      return getMultimodalGuidedCreationService().updateCandidates({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        candidatePasses: payload.candidatePasses as MultimodalCandidatePasses,
      });
    case 'skill.media.overview.confirm':
      return getMultimodalGuidedCreationService().confirmOverview({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        overview: payload.overview as {
          title: string;
          approved: true;
          userNotes: string;
        },
      });
    case 'skill.media.candidate.confirm':
      return getMultimodalGuidedCreationService().confirmCandidates({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        selectedCandidateIds: payload.selectedCandidateIds as string[],
      });
    case 'skill.media.test.start':
      return getMultimodalReleaseService().startArenaTest({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
      });
    case 'skill.media.generate.confirm':
      return getMultimodalReleaseService().confirmGeneration({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        targetPackageId: payload.targetPackageId as string | null,
        expectedPackageVersionId: payload.expectedPackageVersionId as string | null,
      });
    case 'skill.media.publish':
      return getMultimodalReleaseService().publish({
        authUserId: input.auth_user_id,
        sessionId: input.request.sessionId ?? '',
        idempotencyKey: input.request.idempotencyKey ?? '',
        expectedRevisionNo: payload.expectedRevisionNo as number,
        targetPackageId: payload.targetPackageId as string | null,
        expectedPackageVersionId: payload.expectedPackageVersionId as string | null,
      });
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
  let closed = false;
  let streamEnded = false;
  const responseState = input.response as Response & { destroyed?: boolean };
  if (typeof input.response.on === 'function') {
    input.response.on('close', () => {
      closed = true;
    });
  }
  const payload = input.request.payload;

  async function emitSse(event: string, data?: unknown) {
    if (closed || responseState.writableEnded || responseState.destroyed) {
      return;
    }
    writeSseEvent(input.response, event, data);
    if (event === 'stream_end') {
      streamEnded = true;
    }
  }

  try {
    if (input.request.action === 'skill.media.progress.stream') {
      await getMultimodalProgressStreamService().streamProgress({
        authUserId: input.auth_user_id,
        sessionId: String(payload.sessionId ?? ''),
        emit: emitSse,
        isClosed: () =>
          closed || responseState.writableEnded || responseState.destroyed === true,
      });
      return;
    }

    let detail;
    if (input.request.action === 'SkillGuidedCreationStart') {
      await emitSse('phase', { phase: 'understanding' });
      detail = await startGuidedCreation({
        auth_user_id: input.auth_user_id,
        content: payload.content as string,
        client_message_id: payload.client_message_id as string,
        model: payload.model as string | undefined,
        documents: payload.documents as GuidedCreationDocument[] | undefined,
      });
    } else if (input.request.action === 'SkillGuidedCreationMessage') {
      await emitSse('phase', { phase: 'understanding' });
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
        on_phase: (phase) => emitSse('phase', { phase }),
        on_preview: (preview) =>
          emitSse('preview', {
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
      await emitSse('message', { message: assistantMessage });
    }
    if (detail.status === 'ready_for_confirmation') {
      await emitSse('confirmation', { session: detail });
    }
    await emitSse('done', { session: detail });
    await emitSse('stream_end', {});
  } catch (error) {
    const fallbackError =
      input.request.action === 'skill.media.progress.stream'
        ? new GuidedCreationError(
            'MULTIMODAL_PROGRESS_STREAM_FAILED',
            '多模态进度流暂时不可用，请稍后重试。',
            500,
            true,
          )
        : new GuidedCreationError(
            'GUIDED_REQUEST_FAILED',
            '请求处理失败，请重试',
            500,
            true,
          );
    const guidedError =
      error instanceof GuidedCreationError
        ? error
        : fallbackError;
    if (!closed && !responseState.writableEnded && !responseState.destroyed) {
      await emitSse('error', {
        code: guidedError.code,
        message: guidedError.message,
        retryable: guidedError.retryable,
      });
      if (!streamEnded) {
        await emitSse('stream_end', {});
      }
    }
  } finally {
    stopSseHeartbeat(heartbeat);
    if (!closed && !responseState.writableEnded && !responseState.destroyed) {
      input.response.end();
    }
  }
}
