import type { AgentPackageSnapshot, OptimizationIssue, OptimizationResult } from "@educlaw/shared";
import { generateJson } from "./llm-service.js";
import { applyOptimizedSnapshot, getPackage, listVersions } from "./package-service.js";
import { generateReport, getThreadDetail } from "./arena-service.js";

interface ExpertFinding {
  issues: OptimizationIssue[];
}

interface MergeOutput {
  issues: OptimizationIssue[];
  snapshot: AgentPackageSnapshot;
}

type ProgressCallback = (label: string) => Promise<void> | void;

async function runExpert(
  expert: OptimizationIssue["expert"],
  payload: { agentMd: string; rubricMd: string; transcript: string; skills: string },
  model?: string,
) {
  return generateJson<ExpertFinding>({
    model,
    systemPrompt: [
      "You are a package optimization expert.",
      `Your role is: ${expert}.`,
      "Return JSON only with key issues.",
      "Each issue should include expert, target, targetId, title, reason, evidence.",
    ].join("\n"),
    userPrompt: [
      "[agent.md]",
      payload.agentMd,
      "",
      "[rubric.md]",
      payload.rubricMd,
      "",
      "[skills]",
      payload.skills,
      "",
      "[arena transcript]",
      payload.transcript,
    ].join("\n"),
    temperature: 0.2,
  });
}

export async function optimizePackage(
  userId: string,
  packageId: string,
  threadId: string,
  model?: string,
  onProgress?: ProgressCallback,
): Promise<OptimizationResult> {
  await onProgress?.("\u8bfb\u53d6\u667a\u80fd\u4f53\u5305\u4e0e\u5bf9\u8bdd\u8f68\u8ff9");
  const pkg = await getPackage(userId, packageId);
  const detail = await getThreadDetail(userId, threadId);
  if (detail.thread.packageId !== packageId) {
    throw new Error("\u5f53\u524d Arena \u5bf9\u8bdd\u4e0d\u5c5e\u4e8e\u8fd9\u4e2a\u667a\u80fd\u4f53\u5305");
  }

  await onProgress?.("\u751f\u6210\u5f53\u524d\u8bc4\u4f30\u62a5\u544a");
  const report = await generateReport(userId, threadId, model);
  const transcript = detail.messages.map((message) => `${message.side}/${message.role}: ${message.content}`).join("\n\n");
  const skillBundle = pkg.snapshot.skills.map((skill) => `## ${skill.dirName}\n${skill.skillMd}`).join("\n\n");

  await onProgress?.("\u6267\u884c\u89d2\u8272\u4e13\u5bb6\u5206\u6790");
  const persona = await runExpert("persona", { agentMd: pkg.snapshot.agentMd, rubricMd: pkg.snapshot.rubricMd, transcript, skills: skillBundle }, model);
  await onProgress?.("\u6267\u884c\u6280\u80fd\u4e13\u5bb6\u5206\u6790");
  const skill = await runExpert("skill", { agentMd: pkg.snapshot.agentMd, rubricMd: pkg.snapshot.rubricMd, transcript, skills: skillBundle }, model);
  await onProgress?.("\u6267\u884c\u8bc4\u4f30\u4e13\u5bb6\u5206\u6790");
  const rubric = await runExpert("rubric", { agentMd: pkg.snapshot.agentMd, rubricMd: pkg.snapshot.rubricMd, transcript, skills: skillBundle }, model);

  await onProgress?.("\u5408\u5e76\u4e13\u5bb6\u5efa\u8bae\u5e76\u751f\u6210\u65b0\u7248\u672c");
  const merged = await generateJson<MergeOutput>({
    model,
    systemPrompt: [
      "You are the merge expert in a Trace2Skill-lite pipeline.",
      "Return JSON only.",
      "Merge expert findings and produce a full updated package snapshot.",
      "Keep the result reusable and modular.",
    ].join("\n"),
    userPrompt: [
      "[current snapshot]",
      JSON.stringify(pkg.snapshot, null, 2),
      "",
      "[arena report]",
      JSON.stringify(report, null, 2),
      "",
      "[persona expert]",
      JSON.stringify(persona, null, 2),
      "",
      "[skill expert]",
      JSON.stringify(skill, null, 2),
      "",
      "[rubric expert]",
      JSON.stringify(rubric, null, 2),
      "",
      "Return JSON with keys issues and snapshot.",
    ].join("\n"),
    temperature: 0.25,
  });

  await onProgress?.("\u4fdd\u5b58\u4f18\u5316\u540e\u7684\u65b0\u7248\u672c");
  await applyOptimizedSnapshot(userId, packageId, merged.snapshot, "optimized");
  const versions = await listVersions(userId, packageId);
  const latest = versions[0]!;

  return {
    packageId,
    versionId: latest.id,
    versionNumber: latest.versionNumber,
    issues: merged.issues,
    snapshot: latest.snapshot,
  };
}
