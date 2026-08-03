import multer from 'multer';
import { Router, type Request, type Response } from 'express';
import { PACKAGE_ROUTES } from '@educlaw/shared';
import type { AuthedRequest } from '../types.js';
import { config } from '../config.js';
import { getLogger } from '../lib/request-context.js';
import { safeError } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { one } from '../utils/http.js';
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from '../utils/sse.js';
import {
  deletePackage,
  exportPackageZip,
  generatePackage,
  getPackage,
  importPackageZip,
  listPackages,
  listVersions,
  compareVersions,
  renamePackage,
  applyManualMarkdownEdit,
  updateVersionNote,
  repairPackageRubric,
  optimizePackageRubric,
} from '../services/package-service.js';
import { optimizePackage } from '../services/optimization-service.js';
import {
  diagnosePackage,
  chatOptimize,
  applyInteractiveChanges,
  createFeedbackOptimization,
  testFeedbackOptimizationDraft,
  applyFeedbackOptimizationDraft,
  listInteractiveSessions,
  getInteractiveSession,
  type AdoptedChange,
} from '../services/interactive-optimization-service.js';

const router: import('express').Router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadLimitBytes },
});

router.get(PACKAGE_ROUTES.LIST, requireAuth, async (req, res) => {
  res.json(await listPackages((req as AuthedRequest).userId || ''));
});

router.post('/packages/generate', requireAuth, async (req, res) => {
  try {
    const pkg = await generatePackage(
      (req as AuthedRequest).userId || '',
      String(req.body?.instruction || ''),
      typeof req.body?.model === 'string' ? req.body.model : undefined,
      Array.isArray(req.body?.documents) ? req.body.documents : undefined,
    );
    res.json(pkg);
  } catch (error) {
    res
      .status(400)
      .json({
        error: error instanceof Error ? error.message : '生成智能体失败',
      });
  }
});

router.post(
  '/packages/generate/stream',
  requireAuth,
  async (req: Request, res: Response) => {
    initSse(res);
    const startedAt = Date.now();
    const documents: Array<{ name: string; content: string }> | undefined =
      Array.isArray(req.body?.documents) ? req.body.documents : undefined;
    getLogger({ component: 'packages-route' }).info({
      event: 'packages.generate.stream.start',
      userId: (req as AuthedRequest).userId || '',
      instructionLength: String(req.body?.instruction || '').length,
      documentCount: documents?.length || 0,
      documentChars:
        documents?.reduce(
          (sum, doc) => sum + String(doc?.content || '').length,
          0,
        ) || 0,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
    });
    const heartbeat = startSseHeartbeat(
      res,
      Number(process.env.PACKAGE_STREAM_HEARTBEAT_MS || '5000'),
    );
    try {
      writeSseEvent(res, 'phase', { label: '整理需求，准备生成智能体' });
      writeSseEvent(res, 'phase', { label: '调用模型生成智能体内容' });
      const pkg = await generatePackage(
        (req as AuthedRequest).userId || '',
        String(req.body?.instruction || ''),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
        documents,
        (preview) => writeSseEvent(res, 'preview', preview),
        (delta) => writeSseEvent(res, 'preview_delta', delta),
      );
      writeSseEvent(res, 'phase', { label: '保存智能体与初始版本' });
      writeSseEvent(res, 'done', pkg);
      writeSseEvent(res, 'stream_end', { ok: true });
      getLogger({ component: 'packages-route' }).info({
        event: 'packages.generate.stream.done',
        packageId: pkg.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成智能体失败';
      getLogger({ component: 'packages-route' }).error({
        event: 'packages.generate.stream.error',
        durationMs: Date.now() - startedAt,
        error: safeError(error),
      });
      writeSseEvent(res, 'error', { error: message });
      writeSseEvent(res, 'stream_end', { ok: false });
    } finally {
      stopSseHeartbeat(heartbeat);
      res.end();
    }
  },
);

router.post(
  '/packages/import',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        res.status(400).json({ error: '请上传 ZIP 文件' });
        return;
      }
      res.json(
        await importPackageZip(
          (req as AuthedRequest).userId || '',
          req.file.buffer,
        ),
      );
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : '导入失败' });
    }
  },
);

router.get(
  '/packages/:packageId/optimize/sessions',
  requireAuth,
  async (req, res) => {
    try {
      res.json(
        await listInteractiveSessions(
          (req as AuthedRequest).userId || '',
          one(req.params.packageId),
        ),
      );
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '读取优化记录失败',
        });
    }
  },
);

router.get(
  '/packages/:packageId/optimize/sessions/:sessionId',
  requireAuth,
  async (req, res) => {
    try {
      const session = await getInteractiveSession(
        (req as AuthedRequest).userId || '',
        one(req.params.sessionId),
      );
      if (session.packageId !== Number(one(req.params.packageId))) {
        res.status(404).json({ error: '优化记录不存在' });
        return;
      }
      res.json(session);
    } catch (error) {
      res
        .status(404)
        .json({
          error: error instanceof Error ? error.message : '读取优化记录失败',
        });
    }
  },
);

router.get(PACKAGE_ROUTES.DETAIL, requireAuth, async (req, res) => {
  try {
    res.json(
      await getPackage(
        (req as AuthedRequest).userId || '',
        one(req.query.packageId as string | string[] | undefined),
      ),
    );
  } catch (error) {
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : '找不到智能体' });
  }
});

router.patch('/packages/:packageId', requireAuth, async (req, res) => {
  try {
    res.json(
      await renamePackage(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        String(req.body?.name || ''),
      ),
    );
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : '重命名失败' });
  }
});

router.get('/packages/:packageId/versions', requireAuth, async (req, res) => {
  try {
    res.json(
      await listVersions(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
      ),
    );
  } catch (error) {
    res
      .status(404)
      .json({
        error: error instanceof Error ? error.message : '找不到版本记录',
      });
  }
});

router.get('/packages/:packageId/export', requireAuth, async (req, res) => {
  try {
    const packageId = one(req.params.packageId);
    const data = await exportPackageZip(
      (req as AuthedRequest).userId || '',
      packageId,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${packageId}.zip"`,
    );
    res.send(data);
  } catch (error) {
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : '导出失败' });
  }
});

router.post(
  '/packages/:packageId/manual-edit',
  requireAuth,
  async (req, res) => {
    try {
      const result = await applyManualMarkdownEdit(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        {
          target:
            req.body?.target === 'skill'
              ? 'skill'
              : req.body?.target === 'rubric'
                ? 'rubric'
                : 'agent',
          skillId:
            typeof req.body?.skillId === 'string'
              ? req.body.skillId
              : undefined,
          content: String(req.body?.content || ''),
          note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        },
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '保存手动编辑失败',
        });
    }
  },
);

router.post(
  '/packages/:packageId/rubric/repair',
  requireAuth,
  async (req, res) => {
    try {
      const result = await repairPackageRubric(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '修复 rubric 失败',
        });
    }
  },
);

router.post(
  '/packages/:packageId/rubric/optimize',
  requireAuth,
  async (req, res) => {
    try {
      const result = await optimizePackageRubric(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : '优化 rubric 失败',
      });
    }
  },
);

router.post('/packages/:packageId/optimize', requireAuth, async (req, res) => {
  try {
    const result = await optimizePackage(
      (req as AuthedRequest).userId || '',
      one(req.params.packageId),
      String(req.body?.threadId || ''),
      typeof req.body?.model === 'string' ? req.body.model : undefined,
    );
    res.json(result);
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : '优化失败' });
  }
});

router.post(
  '/packages/:packageId/optimize/stream',
  requireAuth,
  async (req: Request, res: Response) => {
    initSse(res);
    const heartbeat = startSseHeartbeat(
      res,
      Number(process.env.PACKAGE_STREAM_HEARTBEAT_MS || '5000'),
    );
    try {
      const result = await optimizePackage(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        String(req.body?.threadId || ''),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
        (label) => writeSseEvent(res, 'phase', { label }),
      );
      writeSseEvent(res, 'done', result);
      writeSseEvent(res, 'stream_end', { ok: true });
    } catch (error) {
      writeSseEvent(res, 'error', {
        error: error instanceof Error ? error.message : '优化失败',
      });
    } finally {
      stopSseHeartbeat(heartbeat);
      res.end();
    }
  },
);

router.post(
  '/packages/:packageId/optimize/diagnose',
  requireAuth,
  async (req, res) => {
    try {
      const result = await diagnosePackage(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        String(req.body?.threadId || ''),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
        typeof req.body?.targetSkillDirName === 'string'
          ? req.body.targetSkillDirName
          : undefined,
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : '诊断失败' });
    }
  },
);

router.post(
  '/packages/:packageId/optimize/chat',
  requireAuth,
  async (req, res) => {
    try {
      const result = await chatOptimize(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        {
          sessionId:
            typeof req.body?.sessionId === 'string'
              ? req.body.sessionId
              : undefined,
          messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
          adoptedChanges: Array.isArray(req.body?.adoptedChanges)
            ? req.body.adoptedChanges
            : [],
          targetSkillDirName:
            typeof req.body?.targetSkillDirName === 'string'
              ? req.body.targetSkillDirName
              : undefined,
        },
        typeof req.body?.model === 'string' ? req.body.model : undefined,
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : '对话失败' });
    }
  },
);

router.post(
  '/packages/:packageId/optimize/apply',
  requireAuth,
  async (req, res) => {
    try {
      const result = await applyInteractiveChanges(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        Array.isArray(req.body?.changes)
          ? (req.body.changes as AdoptedChange[])
          : [],
        typeof req.body?.model === 'string' ? req.body.model : undefined,
        typeof req.body?.note === 'string' ? req.body.note : undefined,
        typeof req.body?.sessionId === 'string'
          ? req.body.sessionId
          : undefined,
        typeof req.body?.targetSkillDirName === 'string'
          ? req.body.targetSkillDirName
          : undefined,
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '应用修改失败',
        });
    }
  },
);

// 反馈式优化：基于用户对单条回答的反馈生成 Skill 优化草稿
router.post(
  '/packages/:packageId/optimize/feedback',
  requireAuth,
  async (req, res) => {
    try {
      const result = await createFeedbackOptimization(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        {
          threadId:
            typeof req.body?.threadId === 'string'
              ? req.body.threadId
              : undefined,
          turnIndex:
            typeof req.body?.turnIndex === 'number'
              ? req.body.turnIndex
              : undefined,
          userQuestion:
            typeof req.body?.userQuestion === 'string'
              ? req.body.userQuestion
              : undefined,
          agentAnswer:
            typeof req.body?.agentAnswer === 'string'
              ? req.body.agentAnswer
              : undefined,
          baselineAnswer:
            typeof req.body?.baselineAnswer === 'string'
              ? req.body.baselineAnswer
              : undefined,
          userFeedback: String(req.body?.userFeedback || ''),
          targetSkillId:
            typeof req.body?.targetSkillId === 'string'
              ? req.body.targetSkillId
              : undefined,
        },
        typeof req.body?.model === 'string' ? req.body.model : undefined,
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : '反馈式优化失败',
      });
    }
  },
);

// 反馈式优化：用草稿快照重测当前问题
router.post(
  '/packages/:packageId/optimize/test-draft',
  requireAuth,
  async (req, res) => {
    try {
      const result = await testFeedbackOptimizationDraft(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        {
          draftSnapshot: req.body?.draftSnapshot,
          userQuestion:
            typeof req.body?.userQuestion === 'string'
              ? req.body.userQuestion
              : undefined,
          model:
            typeof req.body?.model === 'string' ? req.body.model : undefined,
        },
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : '草稿重测失败',
      });
    }
  },
);

// 反馈式优化：将草稿落盘为新版本
router.post(
  '/packages/:packageId/optimize/apply-draft',
  requireAuth,
  async (req, res) => {
    try {
      const result = await applyFeedbackOptimizationDraft(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        {
          draftSnapshot: req.body?.draftSnapshot,
          changeSummary:
            typeof req.body?.changeSummary === 'string'
              ? req.body.changeSummary
              : undefined,
        },
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : '保存草稿失败',
      });
    }
  },
);

router.post(
  '/packages/:packageId/versions/compare',
  requireAuth,
  async (req, res) => {
    try {
      const result = await compareVersions(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        String(req.body?.baseVersionId || ''),
        String(req.body?.targetVersionId || ''),
        typeof req.body?.model === 'string' ? req.body.model : undefined,
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '版本对比失败',
        });
    }
  },
);

router.post(
  '/packages/:packageId/versions/:versionId/note',
  requireAuth,
  async (req, res) => {
    try {
      const result = await updateVersionNote(
        (req as AuthedRequest).userId || '',
        one(req.params.packageId),
        one(req.params.versionId),
        typeof req.body?.note === 'string' ? req.body.note : '',
      );
      res.json(result);
    } catch (error) {
      res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : '更新备注失败',
        });
    }
  },
);

router.delete('/packages/:packageId', requireAuth, async (req, res) => {
  try {
    await deletePackage(
      (req as AuthedRequest).userId || '',
      one(req.params.packageId),
    );
    res.json({ ok: true });
  } catch (error) {
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : '删除失败' });
  }
});

export default router;
