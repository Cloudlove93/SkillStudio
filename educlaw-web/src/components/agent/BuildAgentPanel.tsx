import { useState, useEffect, useRef } from 'react';
import { Loader2, Sparkles, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import * as api from '../../api/manager';
import { useBuildStore } from '../../stores/build';
import { useBatchBuildStore } from '../../stores/batch-build';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useUIStore } from '../../stores/ui';
import { useLibraryStore } from '../../stores/library';
import { useT } from '../../i18n';
import { formatFileSize, LogItem, ProfilePreviewCard, SkillPreviewCard } from './build-components';
import BatchBuildView from './BatchBuildView';

export default function BuildAgentPanel() {
  const t = useT();
  const batchMode = useBatchBuildStore((s) => s.active);
  const buildStoreIsDetailed = useBuildStore((s) => s.isDetailed);
  const buildStoreLogs = useBuildStore((s) => s.logs);
  const [buildMode, setBuildMode] = useState<'quick' | 'detailed'>(
    batchMode || (buildStoreIsDetailed && buildStoreLogs.length > 0) ? 'detailed' : 'quick',
  );
  const [models, setModels] = useState<{ name: string; modelName: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [instruction, setInstruction] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loading = useBuildStore((s) => s.loading);
  const logs = useBuildStore((s) => s.logs);
  const finished = useBuildStore((s) => s.finished);
  const isDetailedBuild = useBuildStore((s) => s.isDetailed);
  const resultAgent = useBuildStore((s) => s.resultAgent);
  const resultSkill = useBuildStore((s) => s.resultSkill);
  const streamingText = useBuildStore((s) => s.streamingText);
  const isStreaming = useBuildStore((s) => s.isStreaming);
  const isWaitingLLM = useBuildStore((s) => s.isWaitingLLM);
  const profilePreview = useBuildStore((s) => s.profilePreview);
  const skillPreview = useBuildStore((s) => s.skillPreview);
  const reset = useBuildStore((s) => s.reset);
  const startQuickBuild = useBuildStore((s) => s.startQuickBuild);
  const startDetailedBuild = useBuildStore((s) => s.startDetailedBuild);

  const openTab = useChatStore((s) => s.openTab);
  const setMainView = useUIStore((s) => s.setMainView);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const setPendingSkillDirName = useUIStore((s) => s.setPendingSkillDirName);

  const pendingBuildScenario = useUIStore((s) => s.pendingBuildScenario);
  const setPendingBuildScenario = useUIStore((s) => s.setPendingBuildScenario);
  useEffect(() => {
    if (pendingBuildScenario) {
      setInstruction(pendingBuildScenario);
      setPendingBuildScenario(null);
    }
  }, [pendingBuildScenario, setPendingBuildScenario]);

  useEffect(() => {
    api.listLLMModels().then((list) => {
      setModels(list);
      if (list.length > 0 && !selectedModel) {
        setSelectedModel(list[0].name);
      }
    });
  }, [selectedModel]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, streamingText, profilePreview, skillPreview]);

  function handleReset() {
    reset();
    useBatchBuildStore.getState().reset();
  }

  function handleClose() {
    if (!loading) {
      reset();
      useBatchBuildStore.getState().reset();
      setUploadedFiles([]);
      setMainView(null);
    }
  }

  function handleGenerate() {
    if (!instruction.trim()) return;
    startQuickBuild(instruction.trim(), selectedModel || undefined);
  }

  async function handleDetailedGenerate() {
    if (uploadedFiles.length === 0) return;
    if (uploadedFiles.length === 1) {
      startDetailedBuild(uploadedFiles[0], selectedModel || undefined);
    } else {
      useBatchBuildStore.getState().startBatch(uploadedFiles, selectedModel || undefined);
    }
  }

  function validateAndAddFiles(files: FileList | File[]) {
    const valid: File[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'txt' || ext === 'md') {
        valid.push(file);
      }
    }
    if (valid.length > 0) {
      setUploadedFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name));
        const newFiles = valid.filter((f) => !existingNames.has(f.name));
        return [...prev, ...newFiles];
      });
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) validateAndAddFiles(e.dataTransfer.files);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) validateAndAddFiles(e.target.files);
    e.target.value = '';
  }

  function removeFile(name: string) {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== name));
  }

  function handleOpenAgent() {
    if (!resultAgent) return;
    const { agents } = useAgentStore.getState();
    if (!agents.some((a) => a.id === resultAgent.id)) {
      useAgentStore.setState((s) => ({ agents: [...s.agents, resultAgent] }));
    }
    openTab(resultAgent.id, resultAgent.name);
    setMainView(null);
    setInstruction('');
    setUploadedFiles([]);
    reset();
  }

  function handleOpenSkill() {
    if (!resultSkill) return;
    useLibraryStore.getState().fetchSkills(true);
    setPendingSkillDirName(resultSkill.dirName);
    setMainView('deep-study');
    setDeepStudyTab('skills');
    setInstruction('');
    setUploadedFiles([]);
    reset();
  }

  const hasLogs = logs.length > 0 || isStreaming || isWaitingLLM || profilePreview !== null || skillPreview !== null;

  const modelSelector = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{t('build.model')}</label>
      <select
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} ({m.modelName})
          </option>
        ))}
      </select>
    </div>
  );

  const progressLog = hasLogs && (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      {logs.map((log, i) => (
        <LogItem key={i} entry={log} t={t} />
      ))}
      {profilePreview && <ProfilePreviewCard preview={profilePreview} t={t} />}
      {skillPreview && <SkillPreviewCard preview={skillPreview} />}
      {isWaitingLLM && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{t('build.waitingLLM')}</span>
        </div>
      )}
      {isStreaming && streamingText && (
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="size-3.5 animate-spin text-blue-500" />
            <span className="text-xs font-medium text-muted-foreground">
              {profilePreview ? t('build.selectingSkills') : t('build.generatingProfile')}
            </span>
          </div>
          <pre className="text-sm text-foreground/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
            {streamingText}
            <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse align-text-bottom ml-0.5" />
          </pre>
        </div>
      )}
      {loading && !finished && !isStreaming && !isWaitingLLM && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{t('build.processing')}</span>
        </div>
      )}
      <div ref={logEndRef} />
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-6 pb-3 pt-5">
        <div className="card-dashboard rounded-[26px] p-4">
          <div className="flex justify-end">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background p-1 shadow-sm">
                <button
                  onClick={() => setBuildMode('quick')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 ${
                    buildMode === 'quick'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Sparkles className="size-3" />
                  {t('build.modeQuick')}
                </button>
                <button
                  onClick={() => setBuildMode('detailed')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 ${
                    buildMode === 'detailed'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <FileUp className="size-3" />
                  {t('build.modeDetailed')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {!hasLogs && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <div className="text-sm font-semibold text-foreground">{t('build.autoDecisionTitle')}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('build.autoDecisionHint')}</p>
            </div>
          )}
          {buildMode === 'quick' && (
            <>
              {!hasLogs && (
                <>
                  {modelSelector}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('build.scenarioLabel')}</label>
                    <Textarea
                      placeholder={t('build.scenarioPlaceholder')}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={6}
                    />
                  </div>
                </>
              )}
              {progressLog}
            </>
          )}

          {buildMode === 'detailed' && !batchMode && (
            <>
              {!hasLogs && (
                <>
                  <p className="text-sm text-muted-foreground">{t('build.detailedHint')}</p>
                  {modelSelector}
                  <div className="space-y-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={handleFileDrop}
                      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 cursor-pointer transition-all duration-200 ${
                        isDragOver
                          ? 'border-blue-500 bg-blue-500/5'
                          : 'border-border hover:border-blue-500/50 hover:bg-muted/30'
                      }`}
                    >
                      <FileUp className={`size-10 mb-3 ${isDragOver ? 'text-blue-500' : 'text-muted-foreground/50'}`} />
                      <p className="text-sm font-medium text-foreground/80">{t('build.dropFile')}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t('build.acceptedFormats')}</p>
                      <p className="text-xs text-muted-foreground/50 mt-0.5">{t('build.batchHint')}</p>
                    </div>

                    {uploadedFiles.length > 0 && (
                      <div className="space-y-2 mt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t('build.fileSelected')} ({uploadedFiles.length})
                          </span>
                          <button
                            onClick={() => setUploadedFiles([])}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t('build.clearAll')}
                          </button>
                        </div>
                        {uploadedFiles.map((file) => (
                          <div key={file.name} className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2.5">
                            <FileUp className="size-4 text-blue-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{file.name}</div>
                              <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {progressLog}
            </>
          )}

          {buildMode === 'detailed' && batchMode && <BatchBuildView />}
        </div>
      </div>

      {!batchMode && (
        <div className="border-t border-border/70 px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-center justify-end gap-3">
            {!hasLogs ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  {t('build.cancel')}
                </Button>
                {buildMode === 'quick' ? (
                  <Button onClick={handleGenerate} disabled={loading || !instruction.trim()}>
                    {t('build.generate')}
                  </Button>
                ) : (
                  <Button onClick={handleDetailedGenerate} disabled={loading || uploadedFiles.length === 0}>
                    {t('build.generate')}
                  </Button>
                )}
              </>
            ) : finished && resultAgent ? (
              isDetailedBuild ? (
                <>
                  <Button variant="outline" onClick={handleOpenAgent}>
                    {t('build.openAgent')}
                  </Button>
                  <Button onClick={handleReset}>
                    {t('build.confirm')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={handleReset}>
                    {t('build.regenerate')}
                  </Button>
                  <Button onClick={handleOpenAgent}>
                    {t('build.openAgent')}
                  </Button>
                </>
              )
            ) : finished && resultSkill ? (
              isDetailedBuild ? (
                <>
                  <Button variant="outline" onClick={handleOpenSkill}>
                    {t('build.openSkill')}
                  </Button>
                  <Button onClick={handleReset}>
                    {t('build.confirm')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={handleReset}>
                    {t('build.regenerate')}
                  </Button>
                  <Button onClick={handleOpenSkill}>
                    {t('build.openSkill')}
                  </Button>
                </>
              )
            ) : finished ? (
              isDetailedBuild ? (
                <Button onClick={handleReset}>
                  {t('build.confirm')}
                </Button>
              ) : (
                <Button variant="outline" onClick={handleReset}>
                  {t('build.back')}
                </Button>
              )
            ) : null}
          </div>
        </div>
      )}

      {batchMode && <BatchBuildFooter onReset={handleReset} onClose={handleClose} />}
    </div>
  );
}

function BatchBuildFooter({ onReset }: { onReset: () => void; onClose: () => void }) {
  const t = useT();
  const allDone = useBatchBuildStore((s) => s.allDone);
  const items = useBatchBuildStore((s) => s.items);
  const total = items.size;
  const doneCount = Array.from(items.values()).filter((i) => i.status === 'done' || i.status === 'error').length;

  return (
    <div className="border-t border-border/70 px-6 py-4">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {allDone ? t('build.batchAllDone') : t('build.batchProgress').replace('{done}', String(doneCount)).replace('{total}', String(total))}
        </span>
        <div className="flex items-center gap-3">
          {allDone ? (
            <Button onClick={onReset}>
              {t('build.confirm')}
            </Button>
          ) : (
            <Button variant="outline" onClick={onReset}>
              {t('build.cancel')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

