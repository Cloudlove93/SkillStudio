import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedRequest } from '../types.js';
import { getPackage } from '../services/package-service.js';
import {
  WorkflowServiceError,
  createWorkflow,
  getWorkflowRun,
  runWorkflow,
  saveWorkflow,
  validateWorkflowForSnapshot,
} from '../services/workflow-service.js';

const router: import('express').Router = Router();

function packageId(req: AuthedRequest) {
  const value = String(req.params.packageId || '').trim();
  if (!/^\d+$/.test(value)) throw new WorkflowServiceError('packageId 无效。', 'WORKFLOW_INVALID');
  return value;
}

function respondError(res: Response, error: unknown) {
  if (error instanceof WorkflowServiceError) {
    res.status(error.status).json({
      code: error.code,
      error: error.message,
      validationErrors: (error as WorkflowServiceError & { validationErrors?: unknown }).validationErrors || [],
    });
    return;
  }
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'PACKAGE_VERSION_CONFLICT') {
    res.status(409).json({ code, error: '版本已变化，请重新加载后再保存。' });
    return;
  }
  res.status(400).json({ code: 'WORKFLOW_REQUEST_FAILED', error: error instanceof Error ? error.message : '工作流请求失败。' });
}

router.post('/workflows', requireAuth, async (req, res) => {
  try {
    res.status(201).json(await createWorkflow(
      (req as AuthedRequest).userId || '',
      req.body?.definition,
    ));
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/packages/:packageId/workflow/validate', requireAuth, async (req, res) => {
  try {
    const id = packageId(req as AuthedRequest);
    const pkg = await getPackage((req as AuthedRequest).userId || '', id);
    const definition = validateWorkflowForSnapshot(req.body?.definition, pkg.snapshot);
    res.json({ valid: true, definition });
  } catch (error) {
    respondError(res, error);
  }
});

router.put('/packages/:packageId/workflow', requireAuth, async (req, res) => {
  try {
    const id = packageId(req as AuthedRequest);
    const expectedPackageVersionId = req.body?.expectedPackageVersionId;
    if (typeof expectedPackageVersionId !== 'string' || !expectedPackageVersionId.trim()) {
      throw new WorkflowServiceError('expectedPackageVersionId 不能为空。', 'WORKFLOW_INVALID');
    }
    res.json(await saveWorkflow((req as AuthedRequest).userId || '', id, {
      expectedPackageVersionId,
      definition: req.body?.definition,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    }));
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/packages/:packageId/workflow/runs', requireAuth, async (req, res) => {
  try {
    const id = packageId(req as AuthedRequest);
    const packageVersionId = req.body?.packageVersionId;
    const requestId = req.body?.requestId;
    const content = req.body?.content;
    if (typeof packageVersionId !== 'string' || typeof requestId !== 'string' || typeof content !== 'string') {
      throw new WorkflowServiceError('packageVersionId、requestId 和 content 必须是文本。', 'WORKFLOW_INVALID');
    }
    res.status(201).json(await runWorkflow((req as AuthedRequest).userId || '', id, {
      packageVersionId,
      requestId,
      content,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
    }));
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/packages/:packageId/workflow/runs/:runId', requireAuth, async (req, res) => {
  try {
    const id = packageId(req as AuthedRequest);
    res.json(await getWorkflowRun((req as AuthedRequest).userId || '', id, String(req.params.runId || '')));
  } catch (error) {
    respondError(res, error);
  }
});

export default router;
