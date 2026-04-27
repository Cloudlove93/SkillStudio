import { Link } from 'react-router';
import { BASE } from '../api/client';
import {
  ArrowLeft,
  MessageSquareText,
  Cpu,
  FileJson2,
  Rocket,
  Wrench,
  BookOpen,
  Sparkles,
  ChevronDown,
  User,
  Target,
  Shield,
  LayoutList,
  ExternalLink,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey } from '../i18n';

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function Connector() {
  return (
    <div className="flex flex-col items-center py-2">
      <div className="h-10 w-px bg-gradient-to-b from-primary/60 to-primary/20" />
      <ChevronDown className="size-5 -mt-1 text-primary/50 animate-bounce" />
    </div>
  );
}

function Badge({ children, color = 'primary' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[color] ?? colors.primary}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Step cards                                                         */
/* ------------------------------------------------------------------ */

function StepCard({
  icon,
  number,
  title,
  subtitle,
  children,
  accent = 'primary',
}: {
  icon: React.ReactNode;
  number: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  accent?: string;
}) {
  const glowMap: Record<string, string> = {
    primary: 'from-primary/20 to-primary/5',
    amber: 'from-amber-500/20 to-amber-500/5',
    emerald: 'from-emerald-500/20 to-emerald-500/5',
    sky: 'from-sky-500/20 to-sky-500/5',
    violet: 'from-violet-500/20 to-violet-500/5',
  };
  const borderMap: Record<string, string> = {
    primary: 'border-primary/30 hover:border-primary/50',
    amber: 'border-amber-500/30 hover:border-amber-500/50',
    emerald: 'border-emerald-500/30 hover:border-emerald-500/50',
    sky: 'border-sky-500/30 hover:border-sky-500/50',
    violet: 'border-violet-500/30 hover:border-violet-500/50',
  };
  const numColorMap: Record<string, string> = {
    primary: 'bg-primary text-primary-foreground',
    amber: 'bg-amber-500 text-white',
    emerald: 'bg-emerald-500 text-white',
    sky: 'bg-sky-500 text-white',
    violet: 'bg-violet-500 text-white',
  };

  return (
    <div className="relative group w-full max-w-2xl mx-auto">
      {/* glow */}
      <div className={`absolute -inset-1 rounded-2xl bg-gradient-to-br ${glowMap[accent]} opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500`} />

      <div className={`relative rounded-2xl border ${borderMap[accent]} bg-card p-6 sm:p-8 transition-all duration-300 shadow-sm hover:shadow-lg`}>
        {/* header */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${numColorMap[accent]} font-bold text-sm shadow-md`}>
            {number}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-muted-foreground/60">{icon}</span>
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground/70">{subtitle}</p>
          </div>
        </div>

        {/* body */}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JSON preview (syntax highlighted with Tailwind)                    */
/* ------------------------------------------------------------------ */

function JsonPreview({ t }: { t: (key: MessageKey) => string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden text-[0.78rem] leading-relaxed font-mono">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/40 bg-muted/50">
        <span className="size-2.5 rounded-full bg-rose-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 text-[0.7rem] text-muted-foreground/50">high-school-math-tutor.json</span>
      </div>
      <pre className="p-4 overflow-x-auto whitespace-pre">
{`{`}
{'\n'}  <span className="text-sky-500">"name"</span>: <span className="text-emerald-500">"{t('workflow.jsonName')}"</span>,
{'\n'}  <span className="text-sky-500">"description"</span>: <span className="text-emerald-500">"{t('workflow.jsonDesc')}"</span>,
{'\n'}  <span className="text-sky-500">"details"</span>: <span className="text-emerald-500">"{t('workflow.jsonDetails')}"</span>,
{'\n'}  <span className="text-sky-500">"agent_runtime"</span>: <span className="text-emerald-500">"micro-learning"</span>,
{'\n'}  <span className="text-sky-500">"tools"</span>: [<span className="text-emerald-500">"quiz-gen"</span>, <span className="text-emerald-500">"latex-render"</span>],
{'\n'}  <span className="text-sky-500">"skills"</span>: [<span className="text-emerald-500">"math-tutor"</span>, <span className="text-emerald-500">"adaptive-difficulty"</span>, <span className="text-emerald-500">"socratic-method"</span>],
{'\n'}  <span className="text-sky-500">"subagents"</span>: []
{'\n'}{`}`}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Details Markdown structure preview                                 */
/* ------------------------------------------------------------------ */

function DetailsStructure({ t }: { t: (key: MessageKey) => string }) {
  const sections = [
    { icon: <User className="size-4" />, title: t('workflow.roleTitle'), desc: t('workflow.roleDesc'), color: 'primary' },
    { icon: <Target className="size-4" />, title: t('workflow.coreTitle'), desc: t('workflow.coreDesc'), color: 'sky' },
    { icon: <Shield className="size-4" />, title: t('workflow.standardTitle'), desc: t('workflow.standardDesc'), color: 'emerald' },
    { icon: <LayoutList className="size-4" />, title: t('workflow.outputTitle'), desc: t('workflow.outputDesc'), color: 'amber' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {sections.map((s) => (
        <div key={s.title} className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
          <span className="text-muted-foreground/60">{s.icon}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{s.title}</p>
            <p className="text-[0.68rem] text-muted-foreground/60 truncate">{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Repository visualization                                           */
/* ------------------------------------------------------------------ */

function RepoVis({ type, items, t }: { type: 'tool' | 'skill'; items: string[]; t: (key: MessageKey) => string }) {
  const isTool = type === 'tool';
  return (
    <div className={`rounded-xl border px-4 py-3 ${isTool ? 'border-amber-500/20 bg-amber-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
      <div className="flex items-center gap-2 mb-2">
        {isTool ? <Wrench className="size-3.5 text-amber-500" /> : <BookOpen className="size-3.5 text-emerald-500" />}
        <span className="text-xs font-semibold">{isTool ? t('workflow.toolRepo') : t('workflow.skillRepo')}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} color={isTool ? 'amber' : 'emerald'}>{item}</Badge>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function AgentProfileWorkflow() {
  const t = useT();

  return (
    <div className="min-h-screen bg-background bg-dot-pattern">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/96">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
          <Button variant="ghost" size="icon" asChild className="size-8">
            <Link to="/"><ArrowLeft className="size-4" /></Link>
          </Button>
          <img src={`${BASE}/logo.png`} alt="EduClaw" className="size-6" />
          <span className="text-sm font-semibold tracking-tight">EduClaw</span>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-sm text-muted-foreground">{t('workflow.header')}</span>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden py-16 sm:py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <Badge color="violet"><Sparkles className="size-3" />AgentProfile Spec v1.0</Badge>
          <h1 className="mt-5 text-3xl sm:text-4xl font-extrabold tracking-tight text-gradient-primary leading-tight">
            {t('workflow.heroTitle')}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground/70 max-w-xl mx-auto leading-relaxed">
            {t('workflow.heroSubtitle')}
          </p>
          <a
            href="https://github.com/EduClaw-InnoSpark/AgentProfile"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <ExternalLink className="size-3.5" />
            {t('workflow.viewSpec')}
          </a>
        </div>
      </section>

      {/* ---- Workflow steps ---- */}
      <section className="mx-auto max-w-4xl px-6 pb-24">

        {/* Step 1: Instruction */}
        <StepCard
          number={1}
          icon={<MessageSquareText className="size-5" />}
          title={t('workflow.step1Title')}
          subtitle={t('workflow.step1Subtitle')}
          accent="primary"
        >
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
            <p className="text-sm italic text-foreground/80">
              {t('workflow.step1Example')}
            </p>
          </div>
        </StepCard>

        <Connector />

        {/* Step 2: Agent Constructor */}
        <StepCard
          number={2}
          icon={<Cpu className="size-5" />}
          title={t('workflow.step2Title')}
          subtitle={t('workflow.step2Subtitle')}
          accent="amber"
        >
          <div className="space-y-4">
            {/* Sub-steps */}
            <div className="space-y-2.5">
              {[
                { label: t('workflow.step2a'), desc: t('workflow.step2aDesc'), badge: 'name / description / details' },
                { label: t('workflow.step2b'), desc: t('workflow.step2bDesc'), badge: 'tools[]' },
                { label: t('workflow.step2c'), desc: t('workflow.step2cDesc'), badge: 'skills[]' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/30 px-4 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[0.65rem] font-bold">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground/60">{item.desc}</span>
                  </div>
                  <code className="hidden sm:block text-[0.68rem] text-amber-600 dark:text-amber-400 bg-amber-500/8 rounded px-2 py-0.5">{item.badge}</code>
                </div>
              ))}
            </div>

            {/* Repos visualization */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RepoVis type="tool" items={['quiz-gen', 'knowledge-graph', 'latex-render', 'progress-track']} t={t} />
              <RepoVis type="skill" items={['math-tutor', 'adaptive-difficulty', 'socratic-method']} t={t} />
            </div>
          </div>
        </StepCard>

        <Connector />

        {/* Step 3: AgentProfile */}
        <StepCard
          number={3}
          icon={<FileJson2 className="size-5" />}
          title={t('workflow.step3Title')}
          subtitle={t('workflow.step3Subtitle')}
          accent="emerald"
        >
          <div className="space-y-4">
            <JsonPreview t={t} />

            <div>
              <p className="text-xs text-muted-foreground/60 mb-2 font-medium">
                {t('workflow.detailsHint')}
              </p>
              <DetailsStructure t={t} />
            </div>
          </div>
        </StepCard>

        <Connector />

        {/* Step 4: Multi-Agent Collaboration */}
        <StepCard
          number={4}
          icon={<Users className="size-5" />}
          title={t('workflow.step4Title')}
          subtitle={t('workflow.step4Subtitle')}
          accent="violet"
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground/60">
              {t('workflow.step4Desc')}
            </p>

            {/* Orchestration diagram */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              {/* Primary agent */}
              <div className="flex items-center gap-3 rounded-lg bg-card border border-border/50 px-4 py-3 mb-3">
                <div className="size-9 rounded-lg bg-gradient-to-br from-violet-500 to-primary flex items-center justify-center shadow">
                  <Cpu className="size-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{t('workflow.mainAgent')}</p>
                  <p className="text-[0.68rem] text-muted-foreground/50">{t('workflow.mainAgentDesc')}</p>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center py-1">
                <div className="flex items-center gap-1 text-violet-400/60">
                  <div className="h-px w-8 bg-violet-400/30" />
                  <span className="text-[0.6rem]">delegate</span>
                  <div className="h-px w-8 bg-violet-400/30" />
                </div>
              </div>

              {/* Sub-agents row */}
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { name: t('workflow.subQuiz'), desc: t('workflow.subQuizDesc'), icon: '\ud83d\udcdd' },
                  { name: t('workflow.subGrade'), desc: t('workflow.subGradeDesc'), icon: '\u2705' },
                  { name: t('workflow.subQA'), desc: t('workflow.subQADesc'), icon: '\ud83d\udca1' },
                ].map((sub) => (
                  <div key={sub.name} className="rounded-lg border border-border/40 bg-card px-3 py-2.5 text-center">
                    <span className="text-lg">{sub.icon}</span>
                    <p className="text-xs font-medium mt-1 truncate">{sub.name}</p>
                    <p className="text-[0.6rem] text-muted-foreground/50 truncate">{sub.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Code hint */}
            <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 font-mono text-[0.75rem]">
              <span className="text-sky-500">"subagents"</span>: [<span className="text-emerald-500">"{t('workflow.subQuiz')}"</span>, <span className="text-emerald-500">"{t('workflow.subGrade')}"</span>, <span className="text-emerald-500">"{t('workflow.subQA')}"</span>]
            </div>
          </div>
        </StepCard>

        <Connector />

        {/* Step 5: Agent Ready */}
        <StepCard
          number={5}
          icon={<Rocket className="size-5" />}
          title={t('workflow.step5Title')}
          subtitle={t('workflow.step5Subtitle')}
          accent="sky"
        >
          <div className="flex items-center gap-4 rounded-xl border border-sky-500/20 bg-sky-500/5 px-5 py-4">
            <div className="relative">
              <div className="size-12 rounded-xl bg-gradient-to-br from-sky-500 to-primary flex items-center justify-center shadow-lg">
                <Cpu className="size-6 text-white" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-400 border-2 border-card animate-pulse-dot" />
            </div>
            <div>
              <p className="text-sm font-semibold">{t('workflow.exampleAgent')}</p>
              <p className="text-xs text-muted-foreground/60">{t('workflow.exampleStatus')}</p>
            </div>
          </div>
        </StepCard>

      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground/40">
        <a
          href="https://github.com/EduClaw-InnoSpark/AgentProfile"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground/50 hover:text-primary transition-colors"
        >
          AgentProfile Spec v1.0
        </a>
        {' '}&mdash; MIT License
      </footer>
    </div>
  );
}

