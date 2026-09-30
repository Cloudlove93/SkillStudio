import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaMessage, PackageVersion } from "@educlaw/shared";
import type { ArenaAnswerRun } from "./arena-service.js";
import type {
  DbRowAnswerSkillOptimizationRun,
  DbRowMessage,
  DbRowThread,
} from "../types.js";

const queryMock = vi.fn();
const getArenaAnswerRunMock = vi.fn();
const buildArenaSidePromptContextMock = vi.fn();
const buildEnhancedPromptMock = vi.fn();
const selectRelevantSkillsMock = vi.fn();
const getVersionMock = vi.fn();
const generateJsonMock = vi.fn();
const generateTextMock = vi.fn();
const validateSkillMock = vi.fn();
const getSkillVersionDetailMock = vi.fn();

class MockArenaAnswerRunNotFoundError extends Error {}
class MockLlmInvalidJsonError extends Error {}

const createdAt = "2026-07-22T08:00:00.000Z";
const createKey = "11111111-1111-4111-8111-111111111111";
const reviseKey = "22222222-2222-4222-8222-222222222222";
const cancelKey = "33333333-3333-4333-8333-333333333333";
const testKey = "44444444-4444-4444-8444-444444444444";

let optimizationRows: DbRowAnswerSkillOptimizationRun[] = [];
let nextOptimizationId = 7001;

const answerRun: ArenaAnswerRun = {
  id: 9001,
  userId: "user-1",
  threadId: 101,
  packageId: 301,
  packageVersionId: 501,
  questionMessageId: 1001,
  enhancedAnswerMessageId: 2002,
  baselineAnswerMessageId: 2001,
  usedSkillIds: ["skill-one"],
  contextMessageIds: [],
  enhancedModel: "recorded-enhanced-model",
  createdAt,
};

const threadRow: DbRowThread = {
  id: 101,
  user_id: "user-1",
  package_id: 301,
  title: "Test thread",
  model: null,
  created_at: createdAt,
  updated_at: createdAt,
};

const messageRows: DbRowMessage[] = [
  {
    id: 901,
    thread_id: 101,
    user_id: "user-1",
    side: "shared",
    role: "user",
    content: "A student described repeated insults.",
    created_at: "2026-07-22T07:00:00.000Z",
  },
  {
    id: 902,
    thread_id: 101,
    user_id: "user-1",
    side: "baseline",
    role: "assistant",
    content: "Earlier baseline answer.",
    created_at: "2026-07-22T07:01:00.000Z",
  },
  {
    id: 903,
    thread_id: 101,
    user_id: "user-1",
    side: "enhanced",
    role: "assistant",
    content: "Earlier enhanced answer.",
    created_at: "2026-07-22T07:01:00.000Z",
  },
  {
    id: 904,
    thread_id: 101,
    user_id: "other-user",
    side: "enhanced",
    role: "assistant",
    content: "Another user's answer.",
    created_at: "2026-07-22T07:02:00.000Z",
  },
  {
    id: 905,
    thread_id: 202,
    user_id: "user-1",
    side: "enhanced",
    role: "assistant",
    content: "Another thread's answer.",
    created_at: "2026-07-22T07:02:00.000Z",
  },
  {
    id: 1001,
    thread_id: 101,
    user_id: "user-1",
    side: "shared",
    role: "user",
    content: "What should the teacher do first?",
    created_at: createdAt,
  },
  {
    id: 2001,
    thread_id: 101,
    user_id: "user-1",
    side: "baseline",
    role: "assistant",
    content: "Keep the student safe and investigate.",
    created_at: createdAt,
  },
  {
    id: 2002,
    thread_id: 101,
    user_id: "user-1",
    side: "enhanced",
    role: "assistant",
    content: "Investigate the situation and contact the family.",
    created_at: createdAt,
  },
  {
    id: 3001,
    thread_id: 101,
    user_id: "user-1",
    side: "enhanced",
    role: "assistant",
    content: "A later enhanced answer.",
    created_at: "2026-07-22T09:00:00.000Z",
  },
];

function skillMd(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: Use when a teacher needs a structured classroom response.",
    "---",
    "",
    "## Instructions",
    "Understand the concern, preserve safety, and avoid unsupported assumptions.",
    "",
    "## Workflow",
    "1. Gather the available facts.\n2. Explain the next safe action.",
    "",
    "## Output Format",
    "Return a summary, ordered actions, useful wording, risks, and follow-up.",
    "",
    "## Examples",
    "Example: organize an urgent classroom concern into practical teacher actions.",
    "",
    "## Common Issues",
    "Do not invent facts, skip safety checks, or present uncertainty as confirmed.",
  ].join("\n");
}

const version: PackageVersion = {
  id: 501,
  packageId: 301,
  versionNumber: 1,
  createdAt,
  source: "generated",
  note: "",
  snapshot: {
    name: "Teacher Assistant",
    description: "Helps teachers respond consistently.",
    versionLabel: "v1",
    agentMd: "Agent instructions",
    rubricMd: "## Dimensions\n- Actionability\n- Safety",
    skills: [
      {
        id: "skill-one",
        dirName: "skill-one",
        name: "Incident Response",
        description: "Use when a teacher needs an incident response.",
        skillMd: skillMd("skill-one"),
      },
      {
        id: "skill-two",
        dirName: "skill-two",
        name: "Family Communication",
        description: "Use when a teacher needs family communication wording.",
        skillMd: skillMd("skill-two"),
      },
    ],
  },
};

function reusableModelOutput(targetSkillId = "skill-one") {
  return {
    diagnosis: {
      summary: "回答缺少按顺序排列的行动步骤和可直接使用的话术。",
      reusability: "reusable",
      riskNotes: [],
    },
    targetSkillId,
    candidateSkills: [],
    patch: {
      section: "Workflow",
      operation: "replace",
      reason: "补充可以直接执行的处理顺序。",
      proposedContent:
        "1. Protect the student.\n2. Verify facts separately.\n3. Contact the family with verified information.\n4. Record follow-up actions.",
    },
  };
}

function passingJudgeOutput() {
  return {
    samples: [
      {
        sampleIndex: 0,
        passed: true,
        score: 92,
        satisfiedRequirements: ["行动步骤清晰且有顺序"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 1,
        passed: true,
        score: 84,
        satisfiedRequirements: ["提供了可以直接使用的话术"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 2,
        passed: false,
        score: 61,
        satisfiedRequirements: [],
        unmetRequirements: ["后续跟进方式仍然不够具体"],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    bestSampleIndex: 0,
    overallSummary: "三个样本中有两个满足了可复用的改进要求。",
  };
}

function refinementModelOutput(
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "applied",
    assistantSummary:
      "已保留原有处理顺序，并根据补充意见加强了中性家长沟通规则。",
    patch: {
      section: "Workflow",
      operation: "replace",
      reason: "在现有步骤中加入中性、基于事实的家长沟通要求。",
      proposedContent:
        "1. Protect the student.\n2. Verify facts separately.\n3. Contact each family with neutral, verified wording.\n4. Do not assign monitoring duties to the student.\n5. Record follow-up actions.",
    },
    ...overrides,
  };
}

function failedStoredTestResult() {
  return {
    testedRevision: 1,
    question: "What should the teacher do first?",
    beforeAnswer: "Investigate the situation and contact the family.",
    afterAnswer: "Passing sample answer.",
    samples: [
      {
        answer: "Passing sample answer.",
        passed: true,
        score: 88,
        satisfiedRequirements: ["Ordered actions"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Failed sample with accusatory family wording.",
        passed: false,
        score: 45,
        satisfiedRequirements: ["Mentions the family"],
        unmetRequirements: ["Family wording is not neutral"],
        riskNotes: ["May present an allegation as confirmed"],
        criticalRisk: false,
      },
      {
        answer: "Failed sample assigning monitoring to the student.",
        passed: false,
        score: 30,
        satisfiedRequirements: [],
        unmetRequirements: ["The student is asked to monitor peers"],
        riskNotes: ["Places responsibility on the affected student"],
        criticalRisk: true,
      },
    ],
    qualityGate: {
      passed: false,
      passedCount: 1,
      sampleCount: 3,
      bestSampleIndex: 0,
      overallSummary:
        "Only one sample met the feedback; family wording and student responsibility remain unsafe.",
    },
    runtimeSelectionCheck: {
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-one"],
      targetSkillSelected: true,
    },
    usedSkillIds: ["skill-one"],
    contextMessageIds: [],
    model: "recorded-enhanced-model",
    replayMode: "recorded_context",
    createdAt: "2026-07-22T08:30:00.000Z",
  } as const;
}

function passedStoredTestResult() {
  return {
    ...failedStoredTestResult(),
    samples: [
      {
        answer: "Passing sample answer.",
        passed: true,
        score: 88,
        satisfiedRequirements: ["Ordered actions"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Second passing sample with neutral family wording.",
        passed: true,
        score: 82,
        satisfiedRequirements: ["Neutral family wording"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Third sample with incomplete follow-up.",
        passed: false,
        score: 60,
        satisfiedRequirements: ["Ordered actions"],
        unmetRequirements: ["Follow-up is incomplete"],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    qualityGate: {
      passed: true,
      passedCount: 2,
      sampleCount: 3,
      bestSampleIndex: 0,
      overallSummary: "Two samples satisfy the reusable feedback.",
    },
  } as const;
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    packageId: 301,
    threadId: 101,
    questionMessageId: 1001,
    enhancedAnswerMessageId: 2002,
    baselineAnswerMessageId: 2001,
    feedback: "Add ordered steps and usable wording.",
    idempotencyKey: createKey,
    ...overrides,
  };
}

function testInput(
  optimizationId: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    userId: "user-1",
    optimizationId,
    expectedRevision: 1,
    idempotencyKey: testKey,
    ...overrides,
  };
}

function parseStoredJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function configureQueryMock() {
  queryMock.mockImplementation(
    async (sql: string, values: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();

      if (
        normalized.includes("from answer_skill_optimization_runs r") &&
        normalized.includes("r.status <> 'cancelled'")
      ) {
        const row = optimizationRows
          .filter(
            (candidate) =>
              candidate.user_id === values[0] &&
              Number(candidate.enhanced_answer_message_id) ===
                Number(values[1]) &&
              candidate.status !== "cancelled",
          )
          .sort((left, right) => Number(right.id) - Number(left.id))[0];
        return {
          rows: row
            ? [{ ...row, final_version_number: null }]
            : [],
          rowCount: row ? 1 : 0,
        };
      }

      if (normalized.startsWith("insert into answer_skill_optimization_runs")) {
        const existing = optimizationRows.find(
          (row) =>
            row.user_id === values[0] && row.create_request_key === values[12],
        );
        if (existing) {
          throw Object.assign(new Error("duplicate create request"), {
            code: "23505",
            constraint:
              "answer_skill_optimization_runs_user_create_key_unique",
          });
        }
        if (
          optimizationRows.some(
            (row) =>
              row.user_id === values[0] &&
              Number(row.enhanced_answer_message_id) === Number(values[5]) &&
              row.status !== "cancelled",
          )
        ) {
          throw Object.assign(new Error("duplicate active answer"), {
            code: "23505",
            constraint:
              "uq_answer_skill_optimization_runs_non_cancelled_answer",
          });
        }
        const row: DbRowAnswerSkillOptimizationRun = {
          id: nextOptimizationId,
          user_id: String(values[0]),
          package_id: Number(values[1]),
          thread_id: Number(values[2]),
          base_version_id: Number(values[3]),
          question_message_id: Number(values[4]),
          enhanced_answer_message_id: Number(values[5]),
          baseline_answer_message_id:
            values[6] === null ? null : Number(values[6]),
          user_feedback: String(values[7]),
          target_skill_id: null,
          result_json: parseStoredJson(values[9]),
          status: String(values[10]),
          revision: Number(values[11]),
          create_request_key: String(values[12]),
          create_request_hash: String(values[13]),
          final_version_id: null,
          created_at: String(values[15]),
          updated_at: String(values[16]),
          answer_side: values[17] as "baseline" | "enhanced",
          answer_message_id: Number(values[18]),
          evidence_version_id: Number(values[19]),
          answer_skill_version_id:
            values[20] === null ? null : Number(values[20]),
          working_skill_version_id:
            values[21] === null ? null : Number(values[21]),
        };
        nextOptimizationId += 1;
        optimizationRows.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("select * from answer_skill_optimization_runs") &&
        normalized.includes("create_request_key = $2")
      ) {
        const row = optimizationRows.find(
          (candidate) =>
            candidate.user_id === values[0] &&
            candidate.create_request_key === values[1],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (
        normalized.startsWith("select * from answer_skill_optimization_runs") &&
        normalized.includes("id = $2")
      ) {
        const row = optimizationRows.find(
          (candidate) =>
            candidate.user_id === values[0] && candidate.id === values[1],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith("select * from arena_threads")) {
        const matches =
          threadRow.id === values[0] &&
          threadRow.user_id === values[1] &&
          threadRow.package_id === values[2];
        return { rows: matches ? [threadRow] : [], rowCount: matches ? 1 : 0 };
      }

      if (
        normalized.startsWith("select * from arena_messages") &&
        normalized.includes("id = any($3::bigint[])")
      ) {
        const messageIds = Array.isArray(values[2])
          ? (values[2] as number[])
          : [];
        const rows = messageRows
          .filter(
            (message) =>
              message.user_id === values[0] &&
              message.thread_id === values[1] &&
              messageIds.includes(message.id),
          )
          .sort(
            (left, right) =>
              left.created_at.localeCompare(right.created_at) ||
              left.id - right.id,
          );
        return { rows, rowCount: rows.length };
      }

      if (normalized.startsWith("select * from arena_messages")) {
        const row = messageRows.find(
          (message) =>
            message.id === values[0] &&
            message.thread_id === values[1] &&
            message.user_id === values[2],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      const row = optimizationRows.find((candidate) => {
        if (normalized.includes("where id = $5")) {
          return candidate.id === values[4] && candidate.user_id === values[5];
        }
        if (normalized.includes("where id = $6")) {
          return candidate.id === values[5] && candidate.user_id === values[6];
        }
        if (normalized.includes("where id = $7")) {
          return candidate.id === values[6] && candidate.user_id === values[7];
        }
        if (normalized.includes("where id = $3")) {
          return candidate.id === values[2] && candidate.user_id === values[3];
        }
        if (normalized.includes("where id = $4")) {
          return candidate.id === values[3] && candidate.user_id === values[4];
        }
        return false;
      });

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set target_skill_id = $1") &&
        normalized.includes("status = $3") &&
        normalized.includes("revision = $4")
      ) {
        const currentResult = row?.result_json as
          | {
              idempotencyResults?: Record<
                string,
                { requestHash?: unknown }
              >;
            }
          | undefined;
        const claimRecord =
          currentResult?.idempotencyResults?.[String(values[8])];
        if (
          !row ||
          row.status !== "processing" ||
          row.revision !== values[7] ||
          claimRecord?.requestHash !== values[9]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.target_skill_id = values[0] === null ? null : String(values[0]);
        row.result_json = parseStoredJson(values[1]);
        row.status = String(values[2]);
        row.revision = Number(values[3]);
        row.updated_at = String(values[4]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set target_skill_id = $1") &&
        normalized.includes("status = 'draft_ready'") &&
        normalized.includes("revision = $3")
      ) {
        const currentResult = row?.result_json as
          | {
              idempotencyResults?: Record<
                string,
                { requestHash?: unknown }
              >;
            }
          | undefined;
        const claimRecord =
          currentResult?.idempotencyResults?.[String(values[7])];
        if (
          !row ||
          row.status !== "processing" ||
          row.revision !== values[6] ||
          claimRecord?.requestHash !== values[8]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.target_skill_id = values[0] === null ? null : String(values[0]);
        row.result_json = parseStoredJson(values[1]);
        row.status = "draft_ready";
        row.revision = Number(values[2]);
        row.updated_at = String(values[3]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set target_skill_id = $1")
      ) {
        if (!row || row.status !== "processing" || row.revision !== values[6]) {
          return { rows: [], rowCount: 0 };
        }
        row.target_skill_id = values[0] === null ? null : String(values[0]);
        row.result_json = parseStoredJson(values[1]);
        row.status = String(values[2]);
        row.updated_at = String(values[3]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set result_json = $1, status = 'failed'")
      ) {
        if (!row || row.status !== "processing" || row.revision !== values[4]) {
          return { rows: [], rowCount: 0 };
        }
        row.result_json = parseStoredJson(values[0]);
        row.status = "failed";
        row.updated_at = String(values[1]);
        return { rows: [], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set result_json = $1, status = 'processing'")
      ) {
        if (
          !row ||
          row.revision !== values[4] ||
          (values.length >= 6
            ? row.status !== values[5]
            : !["draft_ready", "test_ready"].includes(row.status))
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.result_json = parseStoredJson(values[0]);
        row.status = "processing";
        row.updated_at = String(values[1]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("status = 'test_ready'")
      ) {
        const currentResult = row?.result_json as
          | {
              idempotencyResults?: Record<
                string,
                { requestHash?: unknown }
              >;
            }
          | undefined;
        const claimRecord =
          currentResult?.idempotencyResults?.[String(values[5])];
        if (
          !row ||
          row.status !== "processing" ||
          row.revision !== values[4] ||
          claimRecord?.requestHash !== values[6]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.result_json = parseStoredJson(values[0]);
        row.status = "test_ready";
        row.updated_at = String(values[1]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("set result_json = $1, status = $2")
      ) {
        const currentResult = row?.result_json as
          | {
              idempotencyResults?: Record<
                string,
                { requestHash?: unknown }
              >;
            }
          | undefined;
        const claimRecord =
          currentResult?.idempotencyResults?.[String(values[6])];
        if (
          !row ||
          row.status !== "processing" ||
          row.revision !== values[5] ||
          claimRecord?.requestHash !== values[7]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.result_json = parseStoredJson(values[0]);
        row.status = String(values[1]);
        row.updated_at = String(values[2]);
        return { rows: [], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes(
          "set user_feedback = $1, target_skill_id = $2, result_json = $3, status = 'processing'",
        )
      ) {
        if (
          !row ||
          row.revision !== values[6] ||
          !["target_selection_required", "draft_ready", "test_ready", "failed"].includes(
            row.status,
          )
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.user_feedback = String(values[0]);
        row.target_skill_id = values[1] === null ? null : String(values[1]);
        row.result_json = parseStoredJson(values[2]);
        row.status = "processing";
        row.updated_at = String(values[3]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("status = $4")
      ) {
        if (!row || row.status !== "processing" || row.revision !== values[8]) {
          return { rows: [], rowCount: 0 };
        }
        row.user_feedback = String(values[0]);
        row.target_skill_id = values[1] === null ? null : String(values[1]);
        row.result_json = parseStoredJson(values[2]);
        row.status = String(values[3]);
        row.revision = Number(values[4]);
        row.updated_at = String(values[5]);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("target_skill_id = null")
      ) {
        if (!row || row.status !== "processing" || row.revision !== values[6]) {
          return { rows: [], rowCount: 0 };
        }
        row.user_feedback = String(values[0]);
        row.target_skill_id = null;
        row.result_json = parseStoredJson(values[1]);
        row.status = "failed";
        row.revision = Number(values[2]);
        row.updated_at = String(values[3]);
        return { rows: [], rowCount: 1 };
      }

      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("status = 'cancelled'")
      ) {
        if (
          !row ||
          row.revision !== values[4] ||
          !["processing", "target_selection_required", "draft_ready", "test_ready", "failed"].includes(
            row.status,
          )
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.result_json = parseStoredJson(values[0]);
        row.status = "cancelled";
        row.updated_at = String(values[1]);
        return { rows: [row], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  );
}

async function loadService() {
  vi.resetModules();
  vi.doMock("./db.js", () => ({ query: queryMock }));
  vi.doMock("./arena-service.js", () => ({
    ArenaAnswerRunNotFoundError: MockArenaAnswerRunNotFoundError,
    buildArenaSidePromptContext: buildArenaSidePromptContextMock,
    buildEnhancedPrompt: buildEnhancedPromptMock,
    getAnswerOptimizationAvailability: (
      run: Pick<ArenaAnswerRun, "contextMessageIds" | "enhancedModel"> | null,
    ) =>
      !run
        ? { available: false, reason: "missing_answer_run" }
        : run.contextMessageIds === null
          ? { available: false, reason: "replay_context_unavailable" }
          : !run.enhancedModel?.trim()
            ? { available: false, reason: "replay_model_unavailable" }
            : { available: true, reason: null },
    getArenaAnswerRunByEnhancedMessage: getArenaAnswerRunMock,
    parseArenaAnswerContextMessageIds: (value: unknown) => value,
    parseArenaAnswerEnhancedModel: (value: unknown) => value,
    selectRelevantSkills: selectRelevantSkillsMock,
  }));
  vi.doMock("./package-service.js", () => ({
    getVersion: getVersionMock,
    validateSkillMdStandard: validateSkillMock,
  }));
  vi.doMock("./skill-version-service.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./skill-version-service.js")>(),
    getSkillVersionDetail: getSkillVersionDetailMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
    generateText: generateTextMock,
    LlmInvalidJsonError: MockLlmInvalidJsonError,
  }));
  return import("./answer-skill-optimization-service.js");
}

beforeEach(() => {
  optimizationRows = [];
  nextOptimizationId = 7001;
  threadRow.model = null;
  queryMock.mockReset();
  getArenaAnswerRunMock.mockReset();
  buildArenaSidePromptContextMock.mockReset().mockImplementation(
    (
      messages: ArenaMessage[],
      side: "baseline" | "enhanced",
      question: ArenaMessage,
    ) => {
      const historyMessages = messages.filter(
        (message) =>
          (message.side === "shared" && message.role === "user") ||
          (message.side === side && message.role === "assistant"),
      );
      const contextMessageIds = historyMessages.map((message) => message.id);
      return {
        historyMessages,
        contextMessageIds,
        question,
        userPrompt: [...historyMessages, question]
          .map(
            (message) =>
              `${message.role === "user" ? "User" : "Assistant"}: ${
                message.content
              }`,
          )
          .join("\n"),
      };
    },
  );
  buildEnhancedPromptMock.mockReset().mockImplementation(
    (snapshot: PackageVersion["snapshot"], selectedSkills: PackageVersion["snapshot"]["skills"]) =>
      [
        snapshot.agentMd,
        snapshot.rubricMd,
        ...selectedSkills.map((skill) => skill.skillMd),
      ].join("\n"),
  );
  selectRelevantSkillsMock
    .mockReset()
    .mockImplementation(
      (snapshot: PackageVersion["snapshot"]) => snapshot.skills.slice(0, 1),
    );
  getVersionMock.mockReset();
  generateJsonMock.mockReset();
  generateTextMock.mockReset();
  validateSkillMock.mockReset();
  getSkillVersionDetailMock.mockReset().mockResolvedValue({
    skill: version.snapshot.skills[0],
  });
  configureQueryMock();
  getArenaAnswerRunMock.mockResolvedValue({ ...answerRun });
  getVersionMock.mockResolvedValue(version);
  generateJsonMock.mockImplementation(
    (input: { systemPrompt?: string }) =>
      input.systemPrompt?.includes(
        "You evaluate three independently generated answers",
      )
        ? Promise.resolve(passingJudgeOutput())
        : Promise.resolve(reusableModelOutput()),
  );
  generateTextMock.mockResolvedValue(
    JSON.stringify({
      proposedContent:
        "1. Protect the student.\n2. Verify facts.\n3. Record follow-up actions.",
    }),
  );
  validateSkillMock.mockReturnValue([]);
});

describe("answer optimization create workflow", () => {
  it("creates a draft from owner-scoped messages and the recorded base version", async () => {
    const { createAnswerSkillOptimization } = await loadService();
    const result = await createAnswerSkillOptimization(createInput());

    expect(result.status).toBe("draft_ready");
    expect(result.baseVersionId).toBe(501);
    expect(result.question.messageId).toBe(1001);
    expect(result.originalAnswer.messageId).toBe(2002);
    expect(result.targetSkill?.skillId).toBe("skill-one");
    expect(result.patch?.section).toBe("Workflow");
    expect(result.draft?.validation.valid).toBe(true);
    expect(result.diff?.after).toContain("Protect the student");
    expect(getVersionMock).toHaveBeenCalledWith("user-1", 301, "501");
    expect(result.diagnosis?.summary).toContain("回答缺少");
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("localizes an English model result once without changing IDs or enums", async () => {
    const englishOutput = {
      ...reusableModelOutput(),
      diagnosis: {
        summary: "The answer lacks ordered actions and usable wording.",
        reusability: "reusable",
        riskNotes: ["The response may remain too general."],
      },
      patch: {
        ...reusableModelOutput().patch!,
        reason: "Add an executable sequence.",
      },
    };
    const localizedOutput = {
      ...englishOutput,
      diagnosis: {
        ...englishOutput.diagnosis,
        summary: "回答缺少按顺序排列的行动步骤和可直接使用的话术。",
        riskNotes: ["回答仍可能过于笼统。"],
      },
      patch: {
        ...englishOutput.patch,
        reason: "补充可以直接执行的处理顺序。",
      },
    };
    generateJsonMock
      .mockResolvedValueOnce(englishOutput)
      .mockResolvedValueOnce(localizedOutput);
    const { createAnswerSkillOptimization } = await loadService();

    const first = await createAnswerSkillOptimization(createInput());
    const replay = await createAnswerSkillOptimization(createInput());

    expect(first.diagnosis?.summary).toBe(localizedOutput.diagnosis.summary);
    expect(first.targetSkill?.skillId).toBe("skill-one");
    expect(first.patch).toMatchObject({
      section: "Workflow",
      operation: "replace",
      proposedContent: englishOutput.patch.proposedContent,
    });
    expect(replay.optimizationId).toBe(first.optimizationId);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    expect(
      (generateJsonMock.mock.calls[1]?.[0] as { systemPrompt: string })
        .systemPrompt,
    ).toContain("localize one already validated answer optimization result");
  });

  it("localizes proposedContent when the target Skill is mainly Chinese", async () => {
    const chineseVersion = structuredClone(version);
    chineseVersion.snapshot.skills[0] = {
      ...chineseVersion.snapshot.skills[0]!,
      name: "事件处理",
      description: "用于教师处理需要立即响应的学生事件。",
      skillMd: [
        "---",
        "name: skill-one",
        "description: 用于教师处理需要立即响应的学生事件。",
        "---",
        "",
        "## Instructions",
        "先确认学生安全，再核实事实，避免在信息不完整时下结论。",
        "",
        "## Workflow",
        "1. 分别了解情况并记录。\n2. 根据已核实信息联系相关家长。",
        "",
        "## Output Format",
        "输出清晰步骤、沟通话术、风险提醒和后续安排。",
        "",
        "## Examples",
        "示例应帮助班主任把复杂情况整理成当天可执行的行动。",
        "",
        "## Common Issues",
        "不要编造事实，不要跳过安全检查，不要泄露无关个人信息。",
      ].join("\n"),
    };
    getVersionMock.mockResolvedValue(chineseVersion);
    const englishOutput = {
      ...reusableModelOutput(),
      diagnosis: {
        summary: "The answer lacks ordered actions.",
        reusability: "reusable",
        riskNotes: [],
      },
      patch: {
        ...reusableModelOutput().patch!,
        reason: "Add an executable sequence.",
        proposedContent: "1. Protect the student.\n2. Contact the family.",
      },
    };
    generateJsonMock
      .mockResolvedValueOnce(englishOutput)
      .mockResolvedValueOnce({
        ...englishOutput,
        diagnosis: {
          ...englishOutput.diagnosis,
          summary: "回答缺少按顺序排列的行动步骤。",
        },
        patch: {
          ...englishOutput.patch,
          reason: "补充可以直接执行的处理顺序。",
          proposedContent: "1. 先确认学生安全。\n2. 使用已核实的信息联系家长。",
        },
      });
    const { createAnswerSkillOptimization } = await loadService();

    const result = await createAnswerSkillOptimization(createInput());

    expect(result.patch?.proposedContent).toContain("确认学生安全");
    expect(
      (generateJsonMock.mock.calls[1]?.[0] as { systemPrompt: string })
        .systemPrompt,
    ).toContain(
      "also translate patch.proposedContent into Simplified Chinese",
    );
  });

  it("rejects a second non-Chinese localization result without saving it", async () => {
    const englishOutput = {
      ...reusableModelOutput(),
      diagnosis: {
        summary: "The answer remains too general.",
        reusability: "reusable",
        riskNotes: [],
      },
      patch: {
        ...reusableModelOutput().patch!,
        reason: "Add clearer steps.",
      },
    };
    generateJsonMock.mockResolvedValue(englishOutput);
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    const failure = await createAnswerSkillOptimization(createInput()).catch(
      (error: unknown) => error,
    );
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(failure).toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect((failure as Error).message).toContain("未使用简体中文");
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    expect(stored.status).toBe("failed");
    expect(stored.result.diagnosis).toBeUndefined();
    expect(stored.result.patch).toBeNull();
    expect(stored.result.draft).toBeNull();
  });

  it("rejects localization that changes a protected patch enum", async () => {
    const englishOutput = {
      ...reusableModelOutput(),
      diagnosis: {
        summary: "The answer remains too general.",
        reusability: "reusable",
        riskNotes: [],
      },
      patch: {
        ...reusableModelOutput().patch!,
        reason: "Add clearer steps.",
      },
    };
    generateJsonMock
      .mockResolvedValueOnce(englishOutput)
      .mockResolvedValueOnce({
        ...reusableModelOutput(),
        patch: {
          ...reusableModelOutput().patch!,
          operation: "append",
        },
      });
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
  });

  it("rejects missing replay provenance before INSERT or any model call", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds: null,
    });
    const {
      AnswerSkillOptimizationReplayUnavailableError,
      createAnswerSkillOptimization,
    } = await loadService();

    const failure = await createAnswerSkillOptimization(
      createInput(),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(
      AnswerSkillOptimizationReplayUnavailableError,
    );
    expect(failure).toMatchObject({
      reason: "replay_context_unavailable",
    });
    expect(optimizationRows).toHaveLength(0);
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("normalizes bigint version IDs returned as strings by PostgreSQL", async () => {
    getVersionMock.mockResolvedValueOnce({
      ...version,
      id: "501" as unknown as number,
      packageId: "301" as unknown as number,
    });
    const { createAnswerSkillOptimization } = await loadService();

    const result = await createAnswerSkillOptimization(createInput());

    expect(result.status).toBe("draft_ready");
    expect(result.baseVersionId).toBe(501);
  });

  it("returns candidate selection when multiple used Skills are ambiguous", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      usedSkillIds: ["skill-one", "skill-two"],
    });
    generateJsonMock.mockResolvedValue({
      diagnosis: {
        summary: "回答流程和家庭沟通话术都可能需要调整。",
        reusability: "reusable",
        riskNotes: [],
      },
      targetSkillId: null,
      candidateSkills: [
        { skillId: "skill-one", reason: "该 Skill 负责回答处理流程。" },
        { skillId: "skill-two", reason: "该 Skill 负责家庭沟通话术。" },
      ],
      patch: null,
    });
    const { createAnswerSkillOptimization } = await loadService();

    const result = await createAnswerSkillOptimization(createInput());

    expect(result.status).toBe("target_selection_required");
    expect(result.targetSkill).toBeNull();
    expect(result.candidateSkills).toHaveLength(2);
    expect(result.draft).toBeNull();
  });

  it("does not pretend a Skill was used when provenance has none", async () => {
    getArenaAnswerRunMock.mockResolvedValue({ ...answerRun, usedSkillIds: [] });
    generateJsonMock.mockResolvedValue({
      diagnosis: {
        summary: "需要由用户选择一个目标 Skill。",
        reusability: "reusable",
        riskNotes: [],
      },
      targetSkillId: null,
      candidateSkills: [
        { skillId: "skill-one", reason: "这是当前最接近反馈目标的 Skill。" },
      ],
      patch: null,
    });
    const { createAnswerSkillOptimization } = await loadService();

    const result = await createAnswerSkillOptimization(createInput());

    expect(result.status).toBe("target_selection_required");
    expect(result.targetSkill).toBeNull();
  });

  it.each([
    ["single_turn", "feedback_not_reusable"],
    ["unclear", "feedback_unclear"],
  ])("stores non-reusable feedback as failed", async (reusability, failureCode) => {
    generateJsonMock.mockResolvedValue({
      diagnosis: {
        summary: "该反馈目前还不能转化为可复用改进。",
        reusability,
        riskNotes: [],
      },
      targetSkillId: null,
      candidateSkills: [],
      patch: null,
    });
    const { createAnswerSkillOptimization, getAnswerSkillOptimizationRun } =
      await loadService();

    const result = await createAnswerSkillOptimization(createInput());
    const stored = await getAnswerSkillOptimizationRun("user-1", result.optimizationId);

    expect(result.status).toBe("failed");
    expect(stored.result.failure?.code).toBe(failureCode);
    expect(stored.result.diagnosis?.reusability).toBe(reusability);
  });

  it("does not call the model again for an idempotent create retry", async () => {
    const { createAnswerSkillOptimization } = await loadService();

    const first = await createAnswerSkillOptimization(createInput());
    const retry = await createAnswerSkillOptimization(createInput());

    expect(retry.optimizationId).toBe(first.optimizationId);
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("marks the task failed when the model is unavailable", async () => {
    generateJsonMock.mockRejectedValue(new Error("network unavailable"));
    const {
      AnswerSkillOptimizationUpstreamError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationUpstreamError);
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);
    expect(stored.status).toBe("failed");
    expect(stored.result.failure?.code).toBe("model_unavailable");
  });

  it("repairs an invalid Skill draft once and stores only the valid repair", async () => {
    validateSkillMock
      .mockReturnValueOnce(["Workflow content is invalid"])
      .mockReturnValueOnce([]);
    const { createAnswerSkillOptimization, getAnswerSkillOptimizationRun } =
      await loadService();

    const result = await createAnswerSkillOptimization(createInput());
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      result.optimizationId,
    );

    expect(result.status).toBe("draft_ready");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(validateSkillMock).toHaveBeenCalledTimes(2);
    expect(stored.result.patch?.proposedContent).toContain("Verify facts");
    expect(stored.result.draft?.validation.valid).toBe(true);
  });

  it("fails after one rejected repair and never stores the invalid draft", async () => {
    validateSkillMock.mockReturnValue(["Workflow content is invalid"]);
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(validateSkillMock).toHaveBeenCalledTimes(2);
    expect(stored.status).toBe("failed");
    expect(stored.result.failure?.code).toBe("skill_validation_failed");
    expect(stored.result.draft).toBeNull();
  });

  it("rejects malformed structured model output and stores a safe failure", async () => {
    generateJsonMock.mockResolvedValue("not json");
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(stored.status).toBe("failed");
    expect(stored.result.failure?.code).toBe("model_output_invalid");
    expect(stored.result.draft).toBeNull();
  });

  it("classifies syntactically invalid model JSON as a draft error", async () => {
    generateJsonMock.mockRejectedValue(
      new MockLlmInvalidJsonError("Model returned invalid JSON"),
    );
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(stored.result.failure?.code).toBe("model_output_invalid");
  });

  it("classifies invalid repair JSON without making another repair call", async () => {
    validateSkillMock.mockReturnValueOnce(["Workflow content is invalid"]);
    generateTextMock.mockResolvedValueOnce("not json");
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();

    await expect(
      createAnswerSkillOptimization(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    const stored = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(stored.result.failure?.code).toBe("skill_validation_failed");
    expect(stored.result.draft).toBeNull();
  });

  it("restores the owner-scoped Skill preview without exposing package internals", async () => {
    const {
      AnswerSkillOptimizationNotFoundError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationDetail,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const detail = await getAnswerSkillOptimizationDetail(
      "user-1",
      created.optimizationId,
    );

    expect(detail.question.content).toBe("What should the teacher do first?");
    expect(detail.originalAnswer.content).toContain("Investigate");
    expect(detail.draft).toEqual({
      skillId: "skill-one",
      validation: { valid: true, errors: [] },
      previewContent: expect.stringContaining("## Instructions"),
    });
    expect(detail).not.toHaveProperty("snapshot");
    expect(detail).not.toHaveProperty("agentMd");
    expect(detail).not.toHaveProperty("rubricMd");
    expect(detail.replayAvailability).toEqual({
      available: true,
      reason: null,
    });
    await expect(
      getAnswerSkillOptimizationDetail("other-user", created.optimizationId),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
  });

  it("keeps legacy detail readable while marking replay unavailable", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationDetail,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds: null,
    });

    const detail = await getAnswerSkillOptimizationDetail(
      "user-1",
      created.optimizationId,
    );

    expect(detail.status).toBe("draft_ready");
    expect(detail.draft?.validation.valid).toBe(true);
    expect(detail.replayAvailability).toEqual({
      available: false,
      reason: "replay_context_unavailable",
    });
  });
});

describe("answer optimization revise workflow", () => {
  it("blocks revise for an existing legacy optimization before another model call", async () => {
    const {
      AnswerSkillOptimizationReplayUnavailableError,
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const modelCallsAfterCreate = generateJsonMock.mock.calls.length;
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds: null,
    });

    await expect(
      reviseAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: created.revision,
        feedback: "Use a clearer reusable sequence.",
        idempotencyKey: reviseKey,
      }),
    ).rejects.toBeInstanceOf(
      AnswerSkillOptimizationReplayUnavailableError,
    );
    expect(generateJsonMock).toHaveBeenCalledTimes(modelCallsAfterCreate);
    expect(optimizationRows[0]?.status).toBe("draft_ready");
  });

  it("increments revision and applies a user-selected candidate", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      usedSkillIds: ["skill-one", "skill-two"],
    });
    generateJsonMock.mockResolvedValueOnce({
      diagnosis: {
        summary: "请选择需要修改的 Skill。",
        reusability: "reusable",
        riskNotes: [],
      },
      targetSkillId: null,
      candidateSkills: [
        { skillId: "skill-one", reason: "该 Skill 负责处理流程。" },
        { skillId: "skill-two", reason: "该 Skill 负责沟通话术。" },
      ],
      patch: null,
    });
    const { createAnswerSkillOptimization, reviseAnswerSkillOptimization } =
      await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    optimizationRows[0]!.status = "test_ready";
    optimizationRows[0]!.result_json = {
      ...(optimizationRows[0]!.result_json as Record<string, unknown>),
      testResult: {
        testedRevision: 1,
        question: "What should the teacher do first?",
        beforeAnswer: "Before",
        afterAnswer: "After",
        samples: [
          {
            answer: "After",
            passed: true,
            score: 90,
            satisfiedRequirements: ["Clear steps"],
            unmetRequirements: [],
            riskNotes: [],
            criticalRisk: false,
          },
          {
            answer: "After two",
            passed: true,
            score: 82,
            satisfiedRequirements: ["Usable wording"],
            unmetRequirements: [],
            riskNotes: [],
            criticalRisk: false,
          },
          {
            answer: "After three",
            passed: false,
            score: 60,
            satisfiedRequirements: [],
            unmetRequirements: ["Follow-up is vague"],
            riskNotes: [],
            criticalRisk: false,
          },
        ],
        qualityGate: {
          passed: true,
          passedCount: 2,
          sampleCount: 3,
          bestSampleIndex: 0,
          overallSummary: "Two samples pass.",
        },
        runtimeSelectionCheck: {
          targetSkillId: "skill-one",
          selectedSkillIds: ["skill-one"],
          targetSkillSelected: true,
        },
        usedSkillIds: ["skill-one", "skill-two"],
        contextMessageIds: [],
        model: "recorded-enhanced-model",
        replayMode: "recorded_context",
        createdAt,
      },
    };
    generateJsonMock.mockResolvedValueOnce(reusableModelOutput("skill-two"));

    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Focus on family wording.",
      targetSkillId: "skill-two",
      idempotencyKey: reviseKey,
    });

    expect(revised.status).toBe("draft_ready");
    expect(revised.revision).toBe(2);
    expect(revised.targetSkill).toMatchObject({
      skillId: "skill-two",
      selectionSource: "user_selected",
    });
    expect(revised.testResult).toBeNull();
  });

  it("returns 409-style conflict for stale revision and changed idempotent input", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const baseInput = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Use ordered steps.",
      idempotencyKey: reviseKey,
    };
    await reviseAnswerSkillOptimization(baseInput);

    await expect(
      reviseAnswerSkillOptimization({ ...baseInput, feedback: "Different feedback." }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
    await expect(
      reviseAnswerSkillOptimization({
        ...baseInput,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
  });

  it("replays the same revise key without another model call", async () => {
    const { createAnswerSkillOptimization, reviseAnswerSkillOptimization } =
      await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const reviseInput = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Use ordered steps.",
      idempotencyKey: reviseKey,
    };

    const first = await reviseAnswerSkillOptimization(reviseInput);
    const retry = await reviseAnswerSkillOptimization(reviseInput);

    expect(retry.revision).toBe(first.revision);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
  });

  it("lets a concurrent same-key revise replay the claimed processing result", async () => {
    const { createAnswerSkillOptimization, reviseAnswerSkillOptimization } =
      await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    let resolveModel: ((value: unknown) => void) | undefined;
    generateJsonMock.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveModel = resolve;
        }),
    );
    const reviseInput = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Use ordered steps.",
      idempotencyKey: reviseKey,
    };

    const first = reviseAnswerSkillOptimization(reviseInput);
    await vi.waitFor(() => expect(generateJsonMock).toHaveBeenCalledTimes(2));
    const replay = await reviseAnswerSkillOptimization(reviseInput);

    expect(replay.status).toBe("processing");
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    resolveModel?.(reusableModelOutput());
    await expect(first).resolves.toMatchObject({
      status: "draft_ready",
      revision: 2,
    });
  });

  it("rejects a target Skill outside the stored candidates", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      usedSkillIds: ["skill-one", "skill-two"],
    });
    generateJsonMock.mockResolvedValueOnce({
      diagnosis: {
        summary: "请选择一个目标 Skill。",
        reusability: "reusable",
        riskNotes: [],
      },
      targetSkillId: null,
      candidateSkills: [
        { skillId: "skill-one", reason: "该 Skill 负责处理流程。" },
      ],
      patch: null,
    });
    const {
      AnswerSkillOptimizationValidationError,
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      reviseAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        feedback: "Choose another Skill.",
        targetSkillId: "skill-two",
        idempotencyKey: reviseKey,
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
  });

  it.each(["completed", "cancelled"] as const)(
    "does not revise a %s task",
    async (status) => {
      const {
        AnswerSkillOptimizationDraftError,
        createAnswerSkillOptimization,
        reviseAnswerSkillOptimization,
      } = await loadService();
      const created = await createAnswerSkillOptimization(createInput());
      optimizationRows[0]!.status = status;

      await expect(
        reviseAnswerSkillOptimization({
          userId: "user-1",
          optimizationId: created.optimizationId,
          expectedRevision: 1,
          feedback: "Use ordered steps.",
          idempotencyKey: reviseKey,
        }),
      ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    },
  );
});

describe("answer optimization interactive draft refinement", () => {
  it("revises the current draft from an additional user message and records one successful turn", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    generateJsonMock.mockResolvedValueOnce(refinementModelOutput());

    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "再具体一点",
      revisionSource: "draft_review",
      idempotencyKey: reviseKey,
    });
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const refinementPrompt = generateJsonMock.mock.calls[1]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
    };

    expect(revised).toMatchObject({
      status: "draft_ready",
      revision: 2,
      targetSkill: { skillId: "skill-one" },
      testResult: null,
    });
    expect(revised.refinementHistory).toHaveLength(1);
    expect(revised.refinementHistory[0]).toMatchObject({
      source: "draft_review",
      fromRevision: 1,
      toRevision: 2,
      status: "succeeded",
      userMessage: "再具体一点",
      assistantSummary:
        "已保留原有处理顺序，并根据补充意见加强了中性家长沟通规则。",
      qualityEvidence: null,
      outcome: {
        kind: "applied",
        assistantSummary:
          "已保留原有处理顺序，并根据补充意见加强了中性家长沟通规则。",
      },
    });
    expect(stored.result.draft?.skillMd).toContain(
      "Do not assign monitoring duties",
    );
    expect(refinementPrompt.systemPrompt).toContain(
      "Work from the current draft",
    );
    expect(refinementPrompt.systemPrompt).toContain("keep accepted content");
    expect(refinementPrompt.userPrompt).toContain(
      "Add ordered steps and usable wording.",
    );
    expect(refinementPrompt.userPrompt).toContain("currentDraftSkillMd");
    expect(refinementPrompt.userPrompt).toContain("再具体一点");
    expect(refinementPrompt.systemPrompt).toContain(
      "Do not repeat the initial reusable/single-turn/unclear classification",
    );
  });

  it("uses current failed quality evidence without sending passing sample text", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const row = optimizationRows[0]!;
    row.status = "test_ready";
    row.result_json = {
      ...(row.result_json as Record<string, unknown>),
      testResult: failedStoredTestResult(),
    };
    generateJsonMock.mockResolvedValueOnce(refinementModelOutput());

    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback:
        "Use neutral family wording and explicitly forbid assigning monitoring duties to the student.",
      revisionSource: "test_failure",
      idempotencyKey: reviseKey,
    });
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const refinementPrompt = generateJsonMock.mock.calls[1]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
    };

    expect(revised.revision).toBe(2);
    expect(revised.status).toBe("draft_ready");
    expect(stored.result.testResult).toBeNull();
    expect(stored.result.refinementHistory?.[0]).toMatchObject({
      source: "test_failure",
      qualityEvidence: {
        testedRevision: 1,
        runtimeSelectionPassed: true,
        failedSamples: [
          {
            sampleIndex: 1,
            unmetRequirements: ["Family wording is not neutral"],
          },
          {
            sampleIndex: 2,
            criticalRisk: true,
          },
        ],
      },
    });
    expect(refinementPrompt.systemPrompt).toContain(
      "three-sample draft preview that found improvement opportunities",
    );
    expect(refinementPrompt.userPrompt).toContain(
      "family wording and student responsibility remain unsafe",
    );
    expect(refinementPrompt.userPrompt).toContain(
      "Family wording is not neutral",
    );
    expect(refinementPrompt.userPrompt).toContain(
      "Failed sample assigning monitoring to the student.",
    );
    expect(refinementPrompt.userPrompt).not.toContain(
      "Passing sample answer.",
    );
  });

  it("uses failed quality evidence when test_failure has no additional feedback", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const row = optimizationRows[0]!;
    row.status = "test_ready";
    row.result_json = {
      ...(row.result_json as Record<string, unknown>),
      testResult: failedStoredTestResult(),
    };
    generateJsonMock.mockResolvedValueOnce(refinementModelOutput());

    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      revisionSource: "test_failure",
      idempotencyKey: "56565656-5656-4565-8565-565656565656",
    });
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const refinementPrompt = generateJsonMock.mock.calls[1]?.[0] as {
      userPrompt: string;
    };

    expect(revised).toMatchObject({
      status: "draft_ready",
      revision: 2,
      testResult: null,
    });
    expect(refinementPrompt.userPrompt).toContain(
      "family wording and student responsibility remain unsafe",
    );
    expect(refinementPrompt.userPrompt).toContain(
      '"additionalFeedback": null',
    );
    expect(stored.result.refinementHistory?.[0]).toMatchObject({
      source: "test_failure",
      userMessage: "按预览问题修改当前草稿",
      toRevision: 2,
      outcome: { kind: "applied" },
    });
  });

  it("atomically replaces previewed draft v2 with v3 and safely replays the same mutation", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    generateJsonMock.mockResolvedValueOnce(refinementModelOutput());
    const draftV2 = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "Keep the ordered steps and add neutral wording.",
      revisionSource: "draft_review",
      idempotencyKey: reviseKey,
    });
    const row = optimizationRows[0]!;
    row.status = "test_ready";
    row.result_json = {
      ...(row.result_json as Record<string, unknown>),
      testResult: {
        ...failedStoredTestResult(),
        testedRevision: 2,
      },
    };
    generateJsonMock.mockResolvedValueOnce(
      refinementModelOutput({
        assistantSummary:
          "已根据预览问题补充事实核验话术，并保留现有处理顺序。",
        patch: {
          section: "Workflow",
          operation: "replace",
          reason: "解决预览中反复出现的事实认定和沟通措辞问题。",
          proposedContent:
            "1. Protect the student.\n2. Verify facts separately.\n3. State verified facts before contacting each family.\n4. Use neutral family wording.\n5. Do not assign monitoring duties to the student.\n6. Record follow-up actions.",
        },
      }),
    );
    const input = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 2,
      revisionSource: "test_failure" as const,
      idempotencyKey: "58585858-5858-4585-8585-585858585858",
    };

    const draftV3 = await reviseAnswerSkillOptimization(input);
    const modelCallsAfterSuccess = generateJsonMock.mock.calls.length;
    const replayed = await reviseAnswerSkillOptimization(input);
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(draftV2).toMatchObject({
      revision: 2,
      status: "draft_ready",
    });
    expect(draftV3).toMatchObject({
      revision: 3,
      status: "draft_ready",
      question: { content: "What should the teacher do first?" },
      originalAnswer: {
        content: "Investigate the situation and contact the family.",
      },
      replayAvailability: { available: true, reason: null },
      testResult: null,
      patch: {
        proposedContent: expect.stringContaining(
          "State verified facts before contacting each family.",
        ),
      },
      draft: {
        skillId: "skill-one",
        validation: { valid: true, errors: [] },
      },
      diff: {
        after: expect.stringContaining(
          "State verified facts before contacting each family.",
        ),
      },
    });
    expect(draftV3.refinementHistory.at(-1)).toMatchObject({
      source: "test_failure",
      fromRevision: 2,
      toRevision: 3,
      status: "succeeded",
      outcome: { kind: "applied" },
    });
    expect(replayed).toMatchObject({
      revision: 3,
      status: "draft_ready",
      testResult: null,
    });
    expect(generateJsonMock).toHaveBeenCalledTimes(modelCallsAfterSuccess);
    expect(stored).toMatchObject({
      revision: 3,
      status: "draft_ready",
      result: {
        testResult: null,
        patch: {
          proposedContent: expect.stringContaining(
            "State verified facts before contacting each family.",
          ),
        },
        diff: {
          after: expect.stringContaining(
            "State verified facts before contacting each family.",
          ),
        },
      },
    });
    expect(stored.result.draft?.skillMd).toContain(
      "State verified facts before contacting each family.",
    );
  });

  it("requires draft_review after the current quality gate passed", async () => {
    const {
      AnswerSkillOptimizationValidationError,
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const row = optimizationRows[0]!;
    row.status = "test_ready";
    row.result_json = {
      ...(row.result_json as Record<string, unknown>),
      testResult: passedStoredTestResult(),
    };
    await expect(
      reviseAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        additionalFeedback:
          "Keep the successful rules and make the parent wording shorter.",
        revisionSource: "test_failure",
        idempotencyKey: reviseKey,
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the valid draft and old test result when the refinement model fails", async () => {
    const {
      AnswerSkillRefinementTechnicalError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const row = optimizationRows[0]!;
    row.status = "test_ready";
    const originalResult = {
      ...(row.result_json as Record<string, unknown>),
      testResult: failedStoredTestResult(),
    };
    row.result_json = originalResult;
    generateJsonMock.mockRejectedValueOnce(new Error("temporary outage"));
    const refineInput = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "Make the family wording more neutral.",
      revisionSource: "test_failure" as const,
      idempotencyKey: reviseKey,
    };

    await expect(
      reviseAnswerSkillOptimization(refineInput),
    ).rejects.toBeInstanceOf(AnswerSkillRefinementTechnicalError);
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(stored.status).toBe("test_ready");
    expect(stored.revision).toBe(1);
    expect(stored.result.draft).toEqual(
      (originalResult as { draft: unknown }).draft,
    );
    expect(stored.result.testResult?.afterAnswer).toBe(
      "Passing sample answer.",
    );
    expect(stored.result.refinementHistory).toHaveLength(1);
    expect(stored.result.refinementHistory?.[0]).toMatchObject({
      status: "failed",
      toRevision: null,
      userMessage: "Make the family wording more neutral.",
      outcome: {
        kind: "technical_failure",
        code: "model_unavailable",
      },
    });

    await expect(
      reviseAnswerSkillOptimization(refineInput),
    ).rejects.toBeInstanceOf(AnswerSkillRefinementTechnicalError);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    expect(stored.result.refinementHistory).toHaveLength(1);
  });

  it.each([
    [
      "needs_clarification",
      {
        kind: "needs_clarification",
        message: "还需要确认要保留哪部分。",
        clarificationQuestion: "是否保留当前五步结构？",
        suggestedFeedback: ["保留五步结构，只加强家长沟通。"],
      },
    ],
    [
      "not_suitable_for_shared_rule",
      {
        kind: "not_suitable_for_shared_rule",
        message: "姓名只适用于当前回答。",
        suggestedReusableFeedback: "以后统一使用中性占位称呼。",
      },
    ],
  ] as const)(
    "does not replace a valid draft for a %s outcome",
    async (_kind, modelOutcome) => {
      const {
        createAnswerSkillOptimization,
        getAnswerSkillOptimizationRun,
        reviseAnswerSkillOptimization,
      } = await loadService();
      const created = await createAnswerSkillOptimization(createInput());
      const originalDraft = (
        optimizationRows[0]!.result_json as {
          draft: unknown;
        }
      ).draft;
      const originalDiff = (
        optimizationRows[0]!.result_json as {
          diff: unknown;
        }
      ).diff;
      optimizationRows[0]!.status = "test_ready";
      optimizationRows[0]!.result_json = {
        ...(optimizationRows[0]!.result_json as Record<string, unknown>),
        testResult: passedStoredTestResult(),
      };
      generateJsonMock.mockResolvedValueOnce(modelOutcome);

      const result = await reviseAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        additionalFeedback: "Change it somehow.",
        revisionSource: "draft_review",
        idempotencyKey: reviseKey,
      });
      const stored = await getAnswerSkillOptimizationRun(
        "user-1",
        created.optimizationId,
      );

      expect(stored.status).toBe("test_ready");
      expect(stored.revision).toBe(1);
      expect(result.revision).toBe(1);
      expect(stored.result.draft).toEqual(originalDraft);
      expect(stored.result.diff).toEqual(originalDiff);
      expect(stored.result.testResult?.testedRevision).toBe(1);
      expect(stored.result.refinementHistory?.[0]).toMatchObject({
        status: "succeeded",
        toRevision: null,
        outcome: { kind: modelOutcome.kind },
      });
    },
  );

  it("regenerates an alternative from the base Skill and all confirmed user requirements", async () => {
    const {
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    generateJsonMock
      .mockResolvedValueOnce(refinementModelOutput())
      .mockResolvedValueOnce(
        refinementModelOutput({
          assistantSummary: "已从基础规则生成另一套表达方案。",
          patch: {
            section: "Workflow",
            operation: "replace",
            reason: "保留已确认要求并改用另一套步骤表达。",
            proposedContent:
              "1. Check immediate safety.\n2. Ask neutral questions.\n3. Offer teacher-ready wording.\n4. Contact families using verified facts.",
          },
        }),
      );
    const firstFeedback =
      "增加几个教师能够直接使用的话术示例，并保留原有处理顺序。";

    const refined = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: firstFeedback,
      revisionSource: "draft_review",
      idempotencyKey: reviseKey,
    });
    const regenerated = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: refined.revision,
      revisionSource: "alternative_regeneration",
      idempotencyKey: "67676767-6767-4676-8676-676767676767",
    });
    const alternativePrompt = generateJsonMock.mock.calls[2]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
    };

    expect(regenerated).toMatchObject({
      status: "draft_ready",
      revision: 3,
      testResult: null,
    });
    expect(alternativePrompt.systemPrompt).toContain(
      "do not reuse or imitate the wording of any previous draft",
    );
    expect(alternativePrompt.userPrompt).toContain(firstFeedback);
    expect(alternativePrompt.userPrompt).toContain(
      '"initialFeedback": "Add ordered steps and usable wording."',
    );
    expect(alternativePrompt.userPrompt).not.toContain(
      "Do not assign monitoring duties",
    );
    expect(alternativePrompt.userPrompt).not.toContain("currentDraftSkillMd");
    expect(alternativePrompt.userPrompt).not.toContain("currentPatch");
    expect(alternativePrompt.userPrompt).not.toContain("testResult");
    expect(regenerated.refinementHistory.at(-1)).toMatchObject({
      source: "alternative_regeneration",
      fromRevision: 2,
      toRevision: 3,
      outcome: { kind: "applied" },
    });
  });

  it("keeps the latest successful draft through consecutive non-applied attempts", async () => {
    const {
      AnswerSkillRefinementTechnicalError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const initialStored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const initialDraft = structuredClone(initialStored.result.draft);
    const initialDiff = structuredClone(initialStored.result.diff);
    generateJsonMock
      .mockResolvedValueOnce({
        kind: "needs_clarification",
        message: "还需要确认希望加强哪一种话术。",
        clarificationQuestion: "更希望加强学生沟通还是家长沟通？",
        suggestedFeedback: ["保留当前步骤，重点加强家长沟通话术。"],
      })
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(refinementModelOutput());

    const clarification = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "把话术改一下。",
      revisionSource: "draft_review",
      idempotencyKey: "71717171-7171-4717-8171-717171717171",
    });
    await expect(
      reviseAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        additionalFeedback: "重点加强家长沟通话术。",
        revisionSource: "draft_review",
        idempotencyKey: "72727272-7272-4727-8272-727272727272",
      }),
    ).rejects.toBeInstanceOf(AnswerSkillRefinementTechnicalError);
    const afterFailures = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const applied = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "保留步骤，增加可直接使用的家长沟通话术。",
      revisionSource: "draft_review",
      idempotencyKey: "73737373-7373-4737-8373-737373737373",
    });
    const afterApplied = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(clarification.revision).toBe(1);
    expect(afterFailures).toMatchObject({
      revision: 1,
      status: "draft_ready",
    });
    expect(afterFailures.result.draft).toEqual(initialDraft);
    expect(afterFailures.result.diff).toEqual(initialDiff);
    expect(applied.revision).toBe(2);
    expect(afterApplied.result.draft?.skillMd).toContain(
      "Do not assign monitoring duties",
    );
    expect(applied.diff?.after).not.toEqual(initialDiff?.after);
    expect(applied.refinementHistory).toHaveLength(3);
    expect(applied.refinementHistory.map((turn) => turn.outcome?.kind)).toEqual(
      ["needs_clarification", "technical_failure", "applied"],
    );
  });

  it("lets a concurrent same-key refinement replay one pending turn", async () => {
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    let resolveModel: ((value: unknown) => void) | undefined;
    generateJsonMock.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveModel = resolve;
        }),
    );
    const input = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      additionalFeedback: "Keep the steps and strengthen neutral wording.",
      revisionSource: "draft_review" as const,
      idempotencyKey: reviseKey,
    };

    const first = reviseAnswerSkillOptimization(input);
    await vi.waitFor(() => expect(generateJsonMock).toHaveBeenCalledTimes(2));
    const replay = await reviseAnswerSkillOptimization(input);
    const pending = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(replay.status).toBe("processing");
    expect(pending.result.refinementHistory).toHaveLength(1);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    resolveModel?.(refinementModelOutput());
    await expect(first).resolves.toMatchObject({
      status: "draft_ready",
      revision: 2,
    });
    const completed = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    expect(completed.result.refinementHistory).toHaveLength(1);
    expect(completed.result.refinementHistory?.[0]?.status).toBe("succeeded");
  });
});

describe("answer optimization draft test workflow", () => {
  it("tests the server draft against the original question without writing Arena or Package data", async () => {
    threadRow.model = "changed-thread-model";
    const originalSnapshot = structuredClone(version.snapshot);
    generateTextMock.mockResolvedValueOnce(
      "1. Protect the student.\n2. Verify facts separately.\n3. Contact the family.",
    );
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationDetail,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const queryCountBeforeTest = queryMock.mock.calls.length;
    const validationCountBeforeTest = validateSkillMock.mock.calls.length;

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const detail = await getAnswerSkillOptimizationDetail(
      "user-1",
      created.optimizationId,
    );

    expect(tested).toMatchObject({
      optimizationId: created.optimizationId,
      status: "test_ready",
      revision: 1,
      testResult: {
        testedRevision: 1,
        question: "What should the teacher do first?",
        beforeAnswer: "Investigate the situation and contact the family.",
        afterAnswer:
          "1. Protect the student.\n2. Verify facts separately.\n3. Contact the family.",
      },
    });
    expect(stored.result.testResult).toMatchObject({
      testedRevision: 1,
      usedSkillIds: ["skill-one"],
      contextMessageIds: [],
      model: "recorded-enhanced-model",
      replayMode: "recorded_context",
    });
    expect(detail.testResult).not.toHaveProperty("usedSkillIds");
    expect(detail.testResult).not.toHaveProperty("model");
    expect(stored.finalVersionId).toBeNull();
    expect(buildEnhancedPromptMock).toHaveBeenCalledTimes(1);
    expect(validateSkillMock.mock.calls.length).toBeGreaterThan(
      validationCountBeforeTest,
    );

    const [testSnapshot, selectedSkills] =
      buildEnhancedPromptMock.mock.calls[0] as [
        PackageVersion["snapshot"],
        PackageVersion["snapshot"]["skills"],
      ];
    expect(testSnapshot).not.toBe(version.snapshot);
    expect(testSnapshot.skills.find((skill) => skill.id === "skill-one")?.skillMd)
      .toContain("Protect the student");
    expect(selectedSkills.map((skill) => skill.id)).toEqual(["skill-one"]);
    expect(version.snapshot).toEqual(originalSnapshot);

    const llmInput = generateTextMock.mock.calls[0]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
      model?: string;
      temperature: number;
    };
    expect(llmInput.userPrompt).toBe(
      "User: What should the teacher do first?",
    );
    expect(llmInput.model).toBe("recorded-enhanced-model");
    expect(llmInput.temperature).toBe(0.3);
    expect(llmInput.systemPrompt).toContain("Agent instructions");
    expect(llmInput.systemPrompt).toContain("Actionability");
    expect(llmInput.systemPrompt).toContain("Protect the student");
    expect(llmInput.systemPrompt).not.toContain(
      "Add ordered steps and usable wording.",
    );
    expect(llmInput.systemPrompt).not.toContain(
      "Investigate the situation and contact the family.",
    );
    expect(llmInput.systemPrompt).not.toContain(
      "Keep the student safe and investigate.",
    );
    expect(llmInput.systemPrompt).not.toContain("Add an executable sequence.");
    expect(
      getVersionMock.mock.calls.every(
        (call) => call[0] === "user-1" && call[1] === 301 && call[2] === "501",
      ),
    ).toBe(true);

    const testSql = queryMock.mock.calls
      .slice(queryCountBeforeTest)
      .map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
    expect(testSql.some((sql) => sql.includes("insert into arena_messages"))).toBe(
      false,
    );
    expect(testSql.some((sql) => sql.includes("insert into arena_answer_runs"))).toBe(
      false,
    );
    expect(
      testSql.some((sql) => sql.includes("insert into agent_package_versions")),
    ).toBe(false);
    expect(testSql.some((sql) => sql.includes("update agent_packages"))).toBe(
      false,
    );
  });

  it("generates three samples and deterministically passes a two-of-three quality gate", async () => {
    generateTextMock
      .mockResolvedValueOnce("Best answer with ordered steps and wording.")
      .mockResolvedValueOnce("Second acceptable answer.")
      .mockResolvedValueOnce("Third weaker answer.");
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(tested.testResult.samples).toHaveLength(3);
    expect(tested.testResult.afterAnswer).toBe(
      "Best answer with ordered steps and wording.",
    );
    expect(tested.testResult.qualityGate).toMatchObject({
      passed: true,
      passedCount: 2,
      sampleCount: 3,
      bestSampleIndex: 0,
    });
    expect(tested.testResult.runtimeSelectionCheck).toEqual({
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-one"],
      targetSkillSelected: true,
    });
    const judgeInput = generateJsonMock.mock.calls[1]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
      model: string;
      temperature: number;
    };
    expect(judgeInput.model).toBe("recorded-enhanced-model");
    expect(judgeInput.temperature).toBe(0);
    expect(judgeInput.userPrompt).toContain(
      "Add ordered steps and usable wording.",
    );
    expect(judgeInput.userPrompt).toContain("Third weaker answer.");
    expect(judgeInput.userPrompt).toContain(
      "Investigate the situation and contact the family.",
    );
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
  });

  it("judges the current draft against successful refinement feedback", async () => {
    const {
      createAnswerSkillOptimization,
      reviseAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    generateJsonMock.mockResolvedValueOnce(refinementModelOutput());
    const additionalFeedback =
      "Keep the steps and make family wording neutral without assigning monitoring to the student.";
    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: created.revision,
      additionalFeedback,
      revisionSource: "draft_review",
      idempotencyKey: reviseKey,
    });
    generateJsonMock.mockResolvedValueOnce(passingJudgeOutput());

    await testAnswerSkillOptimization(
      testInput(revised.optimizationId, {
        expectedRevision: revised.revision,
      }),
    );

    const judgeInput = generateJsonMock.mock.calls[2]?.[0] as {
      userPrompt: string;
    };
    expect(judgeInput.userPrompt).toContain(
      '"userFeedback":"Add ordered steps and usable wording."',
    );
    expect(judgeInput.userPrompt).toContain(
      `"refinementFeedback":["${additionalFeedback}"]`,
    );
  });

  it("localizes an English Judge result once without changing scores", async () => {
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const englishEvaluation = {
      ...passingJudgeOutput(),
      samples: passingJudgeOutput().samples.map((sample, index) => ({
        ...sample,
        satisfiedRequirements:
          index < 2 ? ["The requested improvement is present."] : [],
        unmetRequirements:
          index === 2 ? ["The follow-up remains vague."] : [],
      })),
      overallSummary: "Two samples satisfy the reusable feedback.",
    };
    generateJsonMock
      .mockResolvedValueOnce(englishEvaluation)
      .mockResolvedValueOnce(passingJudgeOutput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );
    const replay = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(generateJsonMock).toHaveBeenCalledTimes(3);
    expect(replay).toEqual(tested);
    expect(tested.testResult.qualityGate.overallSummary).toContain(
      "三个样本",
    );
    expect(tested.testResult.samples.map((sample) => sample.score)).toEqual([
      92, 84, 61,
    ]);
    expect(
      (generateJsonMock.mock.calls[2]?.[0] as { systemPrompt: string })
        .systemPrompt,
    ).toContain("localize one already validated three-sample evaluation");
  });

  it("rejects Judge localization that changes a protected score", async () => {
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const englishEvaluation = {
      ...passingJudgeOutput(),
      samples: passingJudgeOutput().samples.map((sample, index) => ({
        ...sample,
        satisfiedRequirements:
          index < 2 ? ["The requested improvement is present."] : [],
        unmetRequirements:
          index === 2 ? ["The follow-up remains vague."] : [],
      })),
      overallSummary: "Two samples satisfy the reusable feedback.",
    };
    const changedScore = {
      ...passingJudgeOutput(),
      samples: passingJudgeOutput().samples.map((sample, index) => ({
        ...sample,
        score: index === 0 ? 100 : sample.score,
      })),
    };
    generateJsonMock
      .mockResolvedValueOnce(englishEvaluation)
      .mockResolvedValueOnce(changedScore);

    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(generateJsonMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a second non-Chinese Judge result with a Chinese 422 error", async () => {
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const englishEvaluation = {
      ...passingJudgeOutput(),
      samples: passingJudgeOutput().samples.map((sample, index) => ({
        ...sample,
        satisfiedRequirements:
          index < 2 ? ["The requested improvement is present."] : [],
        unmetRequirements:
          index === 2 ? ["The follow-up remains vague."] : [],
      })),
      overallSummary: "Two samples satisfy the reusable feedback.",
    };
    generateJsonMock.mockResolvedValue(englishEvaluation);

    const failure = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect((failure as Error).message).toBe("重测评估结果无效，请重新重测");
    expect(generateJsonMock).toHaveBeenCalledTimes(3);
  });

  it("keeps test_ready but fails the gate when only one sample passes", async () => {
    generateJsonMock
      .mockResolvedValueOnce(reusableModelOutput())
      .mockResolvedValueOnce({
        ...passingJudgeOutput(),
        samples: passingJudgeOutput().samples.map((sample, index) => ({
          ...sample,
          passed: index === 0,
        })),
      });
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(tested.status).toBe("test_ready");
    expect(tested.testResult.qualityGate).toMatchObject({
      passed: false,
      passedCount: 1,
    });
  });

  it("fails the quality gate when any judged sample has a critical risk", async () => {
    generateJsonMock
      .mockResolvedValueOnce(reusableModelOutput())
      .mockResolvedValueOnce({
        ...passingJudgeOutput(),
        samples: passingJudgeOutput().samples.map((sample, index) => ({
          ...sample,
          criticalRisk: index === 2,
        })),
      });
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(tested.status).toBe("test_ready");
    expect(tested.testResult.qualityGate.passed).toBe(false);
    expect(
      tested.testResult.samples.some((sample) => sample.criticalRisk),
    ).toBe(true);
  });

  it("fails the quality gate when normal runtime selection misses the target Skill", async () => {
    selectRelevantSkillsMock.mockReturnValueOnce([
      version.snapshot.skills[1]!,
    ]);
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(tested.status).toBe("test_ready");
    expect(tested.testResult.runtimeSelectionCheck).toEqual({
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-two"],
      targetSkillSelected: false,
    });
    expect(tested.testResult.qualityGate.passed).toBe(false);
  });

  it("uses the recorded Skill binding instead of auto-routing a fixed Skill answer", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      enhancedSkillVersionId: 20,
    });
    selectRelevantSkillsMock.mockReturnValue([version.snapshot.skills[1]!]);
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId),
    );

    expect(tested.testResult.runtimeSelectionCheck).toEqual({
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-one"],
      targetSkillSelected: true,
    });
    expect(tested.testResult.qualityGate.passed).toBe(true);
    expect(selectRelevantSkillsMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Judge result and restores the stable draft state", async () => {
    generateJsonMock
      .mockResolvedValueOnce(reusableModelOutput())
      .mockResolvedValueOnce({
        samples: passingJudgeOutput().samples.slice(0, 2),
        bestSampleIndex: 0,
        overallSummary: "Incomplete Judge result.",
      });
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    expect(stored.status).toBe("draft_ready");
    expect(stored.result.testResult).toBeNull();
    expect(stored.result.testFailure?.code).toBe("evaluation_invalid");
  });

  it("replays the recorded enhanced history and model for a second-turn question", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds: [901, 903],
      enhancedModel: "original-enhanced-model",
    });
    threadRow.model = "new-thread-model";
    generateTextMock.mockResolvedValueOnce("Context-aware improved answer.");
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await testAnswerSkillOptimization(testInput(created.optimizationId));
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const llmInput = generateTextMock.mock.calls[0]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
      model: string;
      temperature: number;
    };

    expect(llmInput.userPrompt).toBe(
      [
        "User: A student described repeated insults.",
        "Assistant: Earlier enhanced answer.",
        "User: What should the teacher do first?",
      ].join("\n"),
    );
    expect(llmInput.userPrompt).not.toContain("Earlier baseline answer.");
    expect(llmInput.userPrompt).not.toContain(
      "Investigate the situation and contact the family.",
    );
    expect(llmInput.userPrompt).not.toContain("A later enhanced answer.");
    expect(llmInput.userPrompt).not.toContain(
      "Add ordered steps and usable wording.",
    );
    expect(llmInput.userPrompt).not.toContain("Add an executable sequence.");
    expect(llmInput.model).toBe("original-enhanced-model");
    expect(stored.result.testResult).toMatchObject({
      contextMessageIds: [901, 903],
      model: "original-enhanced-model",
      replayMode: "recorded_context",
    });
    expect(buildArenaSidePromptContextMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 901 }),
        expect.objectContaining({ id: 903 }),
      ]),
      "enhanced",
      expect.objectContaining({ id: 1001 }),
    );
  });

  it.each([
    {
      label: "missing context provenance",
      provenance: {
        contextMessageIds: null,
        enhancedModel: "recorded-enhanced-model",
      },
      failureCode: "replay_context_unavailable",
    },
    {
      label: "missing model provenance",
      provenance: {
        contextMessageIds: [],
        enhancedModel: null,
      },
      failureCode: "replay_model_unavailable",
    },
  ])("rejects an old answer run with $label", async ({ provenance, failureCode }) => {
    const {
      AnswerSkillOptimizationReplayUnavailableError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      ...provenance,
    });

    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toMatchObject({
      name: AnswerSkillOptimizationReplayUnavailableError.name,
      reason: failureCode,
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a missing message",
      contextMessageIds: [901, 999],
    },
    {
      label: "another owner's message",
      contextMessageIds: [901, 904],
    },
    {
      label: "another thread's message",
      contextMessageIds: [901, 905],
    },
    {
      label: "messages in the wrong order",
      contextMessageIds: [903, 901],
    },
    {
      label: "a baseline message",
      contextMessageIds: [901, 902],
    },
    {
      label: "a message after the target question",
      contextMessageIds: [901, 3001],
    },
  ])("rejects replay provenance containing $label", async ({ contextMessageIds }) => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds,
    });
    const {
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("keeps every recorded used Skill while replacing only the target draft", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      usedSkillIds: ["skill-one", "skill-two"],
    });
    generateJsonMock.mockResolvedValueOnce(reusableModelOutput("skill-one"));
    generateTextMock.mockResolvedValueOnce("Answer using both recorded Skills.");
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await testAnswerSkillOptimization(testInput(created.optimizationId));
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const selectedSkills = buildEnhancedPromptMock.mock.calls[0]?.[1] as
      | PackageVersion["snapshot"]["skills"]
      | undefined;

    expect(selectedSkills?.map((skill) => skill.id)).toEqual([
      "skill-one",
      "skill-two",
    ]);
    expect(selectedSkills?.[0]?.skillMd).toContain("Protect the student");
    expect(selectedSkills?.[1]?.skillMd).toBe(
      version.snapshot.skills[1]?.skillMd,
    );
    expect(stored.result.testResult?.usedSkillIds).toEqual([
      "skill-one",
      "skill-two",
    ]);
  });

  it("uses the user-selected target when the original answer recorded no Skill", async () => {
    getArenaAnswerRunMock.mockResolvedValue({ ...answerRun, usedSkillIds: [] });
    generateJsonMock
      .mockResolvedValueOnce({
        diagnosis: {
          summary: "需要由用户选择一个目标 Skill。",
          reusability: "reusable",
          riskNotes: [],
        },
        targetSkillId: null,
        candidateSkills: [
          { skillId: "skill-one", reason: "该 Skill 负责回答处理流程。" },
        ],
        patch: null,
      })
      .mockResolvedValueOnce(reusableModelOutput("skill-one"));
    generateTextMock.mockResolvedValueOnce("Improved selected-Skill answer.");
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Use a reusable ordered response workflow.",
      targetSkillId: "skill-one",
      idempotencyKey: reviseKey,
    });

    const tested = await testAnswerSkillOptimization(
      testInput(created.optimizationId, { expectedRevision: 2 }),
    );
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(revised.targetSkill?.selectionSource).toBe("user_selected");
    expect(tested.revision).toBe(2);
    expect(stored.result.testResult?.usedSkillIds).toEqual(["skill-one"]);
    const selectedSkills = buildEnhancedPromptMock.mock.calls[0]?.[1] as
      | PackageVersion["snapshot"]["skills"]
      | undefined;
    expect(selectedSkills?.map((skill) => skill.id)).toEqual(["skill-one"]);
  });

  it("replays the same test key without a second model call", async () => {
    generateTextMock.mockResolvedValueOnce("Improved answer.");
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const input = testInput(created.optimizationId);

    const first = await testAnswerSkillOptimization(input);
    const retry = await testAnswerSkillOptimization(input);

    expect(retry).toEqual(first);
    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
  });

  it("can successfully retest test_ready without increasing revision", async () => {
    generateTextMock
      .mockResolvedValueOnce("First draft answer.")
      .mockResolvedValueOnce("First alternate answer.")
      .mockResolvedValueOnce("First third answer.")
      .mockResolvedValueOnce("Second draft answer.")
      .mockResolvedValueOnce("Second alternate answer.")
      .mockResolvedValueOnce("Second third answer.");
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    await testAnswerSkillOptimization(testInput(created.optimizationId));
    const beforeRetest = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    const draftBeforeRetest = structuredClone(beforeRetest.result.draft);
    const diffBeforeRetest = structuredClone(beforeRetest.result.diff);
    const historyBeforeRetest = structuredClone(
      beforeRetest.result.refinementHistory,
    );

    const retested = await testAnswerSkillOptimization(
      testInput(created.optimizationId, {
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      }),
    );
    const afterRetest = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(retested.status).toBe("test_ready");
    expect(retested.revision).toBe(1);
    expect(retested.testResult.afterAnswer).toBe("Second draft answer.");
    expect(afterRetest.result.draft).toEqual(draftBeforeRetest);
    expect(afterRetest.result.diff).toEqual(diffBeforeRetest);
    expect(afterRetest.result.refinementHistory).toEqual(historyBeforeRetest);
    expect(generateTextMock).toHaveBeenCalledTimes(6);
  });

  it("lets concurrent same-key tests share the first generated result", async () => {
    let resolveGeneration: ((value: string) => void) | undefined;
    generateTextMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const input = testInput(created.optimizationId);

    const first = testAnswerSkillOptimization(input);
    await vi.waitFor(() => expect(generateTextMock).toHaveBeenCalledTimes(3));
    const concurrentRetry = testAnswerSkillOptimization(input);
    await new Promise((resolve) => setTimeout(resolve, 10));
    resolveGeneration?.("One generated answer.");
    const [firstResult, retryResult] = await Promise.all([
      first,
      concurrentRetry,
    ]);

    expect(retryResult).toEqual(firstResult);
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it("allows only one of two different test keys to claim the revision", async () => {
    let resolveGeneration: ((value: string) => void) | undefined;
    generateTextMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    const {
      AnswerSkillOptimizationConflictError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const first = testAnswerSkillOptimization(testInput(created.optimizationId));
    await vi.waitFor(() => expect(generateTextMock).toHaveBeenCalledTimes(3));
    await expect(
      testAnswerSkillOptimization(
        testInput(created.optimizationId, {
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
        }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
    resolveGeneration?.("First claimed answer.");
    await expect(first).resolves.toMatchObject({ status: "test_ready" });
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a reused test key with a different request hash", async () => {
    generateTextMock.mockResolvedValueOnce("Improved answer.");
    const {
      AnswerSkillOptimizationConflictError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    await testAnswerSkillOptimization(testInput(created.optimizationId));

    await expect(
      testAnswerSkillOptimization(
        testInput(created.optimizationId, { expectedRevision: 2 }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it("restores draft_ready and safely replays an upstream failure", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("private upstream body"));
    const {
      AnswerSkillOptimizationUpstreamError,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const input = testInput(created.optimizationId);

    await expect(testAnswerSkillOptimization(input)).rejects.toBeInstanceOf(
      AnswerSkillOptimizationUpstreamError,
    );
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );
    expect(stored.status).toBe("draft_ready");
    expect(stored.result.testResult).toBeNull();
    expect(stored.result.testFailure).toMatchObject({
      code: "model_unavailable",
    });
    expect(JSON.stringify(stored.result)).not.toContain(
      "private upstream body",
    );

    await expect(testAnswerSkillOptimization(input)).rejects.toBeInstanceOf(
      AnswerSkillOptimizationUpstreamError,
    );
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it("preserves an older same-revision test result when a retest fails", async () => {
    generateTextMock
      .mockResolvedValueOnce("Previously successful answer.")
      .mockResolvedValueOnce("Previously successful alternate.")
      .mockResolvedValueOnce("Previously successful third.")
      .mockRejectedValueOnce(new Error("temporary outage"));
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    await testAnswerSkillOptimization(testInput(created.optimizationId));

    await expect(
      testAnswerSkillOptimization(
        testInput(created.optimizationId, {
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
        }),
      ),
    ).rejects.toThrow();
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(stored.status).toBe("test_ready");
    expect(stored.result.testResult?.afterAnswer).toBe(
      "Previously successful answer.",
    );
  });

  it("does not report success when the completion update fails", async () => {
    generateTextMock.mockResolvedValueOnce("Generated but not persisted.");
    const {
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const baseQueryImplementation = queryMock.getMockImplementation();
    if (!baseQueryImplementation) throw new Error("Query mock is unavailable");
    queryMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (
        normalized.startsWith("update answer_skill_optimization_runs") &&
        normalized.includes("status = 'test_ready'")
      ) {
        throw new Error("completion write failed");
      }
      return baseQueryImplementation(sql, values);
    });

    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toThrow("completion write failed");
    expect(optimizationRows[0]?.status).toBe("processing");
    expect(optimizationRows[0]?.final_version_id).toBeNull();
  });

  it("rejects stale revisions, invalid states, and invalid stored drafts before the model call", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      AnswerSkillOptimizationDraftError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      testAnswerSkillOptimization(
        testInput(created.optimizationId, { expectedRevision: 2 }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);

    optimizationRows[0]!.status = "target_selection_required";
    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);

    optimizationRows[0]!.status = "draft_ready";
    const result = optimizationRows[0]!.result_json as Record<string, unknown>;
    const originalDraft = result.draft;
    result.draft = null;
    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);

    result.draft = originalDraft;
    result.draft = {
      ...(result.draft as Record<string, unknown>),
      skillMd: `${String(
        (result.draft as Record<string, unknown>).skillMd,
      )}\nTampered content`,
    };
    await expect(
      testAnswerSkillOptimization(testInput(created.optimizationId)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("clears a persisted test result when revise creates the next revision", async () => {
    generateTextMock.mockResolvedValueOnce("Tested draft answer.");
    const {
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
      reviseAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    await testAnswerSkillOptimization(testInput(created.optimizationId));

    const revised = await reviseAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      feedback: "Keep the same reusable goal but make the sequence shorter.",
      idempotencyKey: reviseKey,
    });
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(revised.revision).toBe(2);
    expect(revised.testResult).toBeNull();
    expect(stored.result.testResult).toBeNull();
    expect(stored.result.testFailure).toBeNull();
  });

  it.each(["failed", "cancelled", "completed"] as const)(
    "does not test a %s optimization",
    async (status) => {
      const {
        AnswerSkillOptimizationDraftError,
        createAnswerSkillOptimization,
        testAnswerSkillOptimization,
      } = await loadService();
      const created = await createAnswerSkillOptimization(createInput());
      optimizationRows[0]!.status = status;

      await expect(
        testAnswerSkillOptimization(testInput(created.optimizationId)),
      ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
      expect(generateTextMock).not.toHaveBeenCalled();
    },
  );

  it("keeps owner scope when loading a draft test", async () => {
    const {
      AnswerSkillOptimizationNotFoundError,
      createAnswerSkillOptimization,
      testAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      testAnswerSkillOptimization(
        testInput(created.optimizationId, { userId: "other-user" }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("answer optimization cancel workflow", () => {
  it("still allows an existing legacy optimization to be cancelled", async () => {
    const {
      cancelAnswerSkillOptimization,
      createAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    getArenaAnswerRunMock.mockResolvedValue({
      ...answerRun,
      contextMessageIds: null,
      enhancedModel: null,
    });

    const cancelled = await cancelAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: created.revision,
      reason: "user_cancelled",
      idempotencyKey: cancelKey,
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.revision).toBe(created.revision);
  });

  it("cancels without deleting the stored draft or changing revision", async () => {
    const {
      cancelAnswerSkillOptimization,
      createAnswerSkillOptimization,
      getAnswerSkillOptimizationRun,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    const cancelled = await cancelAnswerSkillOptimization({
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      reason: "user_cancelled",
      idempotencyKey: cancelKey,
    });
    const stored = await getAnswerSkillOptimizationRun(
      "user-1",
      created.optimizationId,
    );

    expect(cancelled).toMatchObject({ status: "cancelled", revision: 1 });
    expect(stored.result.draft?.skillMd).toContain("Protect the student");
    expect(stored.finalVersionId).toBeNull();
  });

  it("replays a repeated cancel and rejects a reused key with another reason", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      cancelAnswerSkillOptimization,
      createAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());
    const cancelInput = {
      userId: "user-1",
      optimizationId: created.optimizationId,
      expectedRevision: 1,
      reason: "user_cancelled" as const,
      idempotencyKey: cancelKey,
    };

    const first = await cancelAnswerSkillOptimization(cancelInput);
    const retry = await cancelAnswerSkillOptimization(cancelInput);
    expect(retry).toEqual(first);
    await expect(
      cancelAnswerSkillOptimization({
        ...cancelInput,
        reason: "restart_required",
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
  });

  it("rejects invalid reason, stale revision, and completed tasks", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      AnswerSkillOptimizationDraftError,
      AnswerSkillOptimizationValidationError,
      cancelAnswerSkillOptimization,
      createAnswerSkillOptimization,
    } = await loadService();
    const created = await createAnswerSkillOptimization(createInput());

    await expect(
      cancelAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        reason: "invalid" as "user_cancelled",
        idempotencyKey: cancelKey,
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
    await expect(
      cancelAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 2,
        reason: "user_cancelled",
        idempotencyKey: cancelKey,
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);

    optimizationRows[0]!.status = "completed";
    await expect(
      cancelAnswerSkillOptimization({
        userId: "user-1",
        optimizationId: created.optimizationId,
        expectedRevision: 1,
        reason: "user_cancelled",
        idempotencyKey: cancelKey,
      }),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
  });
});
