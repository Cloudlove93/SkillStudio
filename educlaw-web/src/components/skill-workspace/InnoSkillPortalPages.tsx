import type { GuidedCreationSession } from '@educlaw/shared';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleDashed,
  Clock3,
  GitBranch,
  GraduationCap,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import type { RepositorySkill } from './SkillRepositoryWorkspace';
import { getSessionName } from './SkillWorkspaceSidebar';

export type InnoSkillPortalView =
  | 'home'
  | 'square'
  | 'workbench'
  | 'pipeline'
  | 'review';

type Props = {
  view: InnoSkillPortalView;
  skills: RepositorySkill[];
  sessions: GuidedCreationSession[];
  search: string;
  onSearch: (value: string) => void;
  onNew: () => void;
  onOpenSquare: (query?: string) => void;
  onOpenMySkills: () => void;
  onOpenSkill: (skill: RepositorySkill) => void;
  onOpenVersions: (skill: RepositorySkill) => void;
  onOpenDraft: (session: GuidedCreationSession) => void;
  onOpenPipeline: () => void;
  onOpenReview: () => void;
};

const domains = [
  { label: '教学', description: '备课、授课、课堂互动', icon: GraduationCap },
  { label: '学习', description: '练习、伴学、错题归因', icon: BookOpenCheck },
  { label: '管理', description: '班级事务、家校沟通', icon: Users },
  { label: '评价', description: '测评、诊断、量规设计', icon: BadgeCheck },
  { label: '研究', description: '教研、课例研究', icon: Sparkles },
] as const;

const stageLabels = [
  '创作想法',
  '原型',
  '评测',
  '审核',
  '灰度',
  '发布',
  '反馈',
];

export function InnoSkillPortalPages(props: Props) {
  if (props.view === 'home') return <PortalHome {...props} />;
  if (props.view === 'square') return <SkillSquare {...props} />;
  if (props.view === 'workbench') return <Workbench {...props} />;
  if (props.view === 'pipeline') return <Pipeline {...props} />;
  return <ReviewCenter {...props} />;
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="isk-page-header">
      <div>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

function PortalHome(props: Props) {
  const featured = props.skills.slice(0, 4);
  return (
    <main className="isk-portal-page isk-home-page skill-view-enter">
      <section className="isk-home-hero">
        <span>INNOSKILL · 教学经验转化平台</span>
        <h1>找到好用的，改成自己的</h1>
        <p>
          汇聚真实教学经验形成的 Skill——直接使用，或改编成适合自己课堂的版本。
        </p>
        <div>
          <button
            type="button"
            className="is-primary"
            onClick={() => props.onOpenSquare()}
          >
            探索 Skill 广场 <ArrowRight size={15} />
          </button>
          <button type="button" onClick={props.onNew}>
            <Plus size={15} /> 新建 Skill
          </button>
        </div>
      </section>

      <section className="isk-home-section">
        <header>
          <h2>按场景探索</h2>
        </header>
        <div className="isk-domain-grid">
          {domains.map(({ label, description, icon: Icon }) => (
            <button
              type="button"
              key={label}
              onClick={() => props.onOpenSquare(label)}
            >
              <Icon size={18} />
              <strong>{label}</strong>
              <small>{description}</small>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </section>

      <section className="isk-home-section">
        <header>
          <div>
            <h2>精选推荐</h2>
            <p>来自当前 Skill 仓库的可用能力</p>
          </div>
          <button type="button" onClick={() => props.onOpenSquare()}>
            查看全部
          </button>
        </header>
        {featured.length ? (
          <div className="isk-featured-layout">
            <div className="isk-skill-grid">
              {featured.map((skill, index) => (
                <PortalSkillCard
                  key={skill.key}
                  skill={skill}
                  index={index}
                  onOpen={() => props.onOpenSkill(skill)}
                />
              ))}
            </div>
            <aside className="isk-ranking-card">
              <span>热门榜</span>
              <small>按最近更新时间排序</small>
              {props.skills.slice(0, 5).map((skill, index) => (
                <button
                  type="button"
                  key={skill.key}
                  onClick={() => props.onOpenSkill(skill)}
                >
                  <b>{index + 1}</b>
                  <span>{skill.name}</span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </aside>
          </div>
        ) : (
          <PortalEmpty
            label="还没有可推荐的 Skill，先创建第一个吧。"
            onAction={props.onNew}
          />
        )}
      </section>

      <section className="isk-home-cta">
        <div>
          <strong>有自己的教学方法？</strong>
          <p>通过对话共创、材料提炼或实录蒸馏，把它转化为可复用的 Skill。</p>
        </div>
        <button type="button" onClick={props.onNew}>
          <Plus size={15} />
          新建 Skill
        </button>
      </section>
    </main>
  );
}

function SkillSquare(props: Props) {
  const query = props.search.trim().toLocaleLowerCase();
  const skills = props.skills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query),
  );
  return (
    <main className="isk-portal-page skill-view-enter">
      <PageHeader
        eyebrow="Skill 广场"
        title="发现可复用的教学能力"
        description="浏览现有 Skill，打开后即可试用，也可以继续优化成自己的版本。"
        action={
          <button className="isk-primary-action" onClick={props.onNew}>
            <Plus size={15} />
            新建 Skill
          </button>
        }
      />
      <div className="isk-square-toolbar">
        <label>
          <Search size={16} />
          <input
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            placeholder="搜索名称、场景或能力…"
          />
        </label>
        <div>
          {domains.map(({ label }) => (
            <button
              type="button"
              key={label}
              onClick={() => props.onSearch(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {skills.length ? (
        <div className="isk-square-grid">
          {skills.map((skill, index) => (
            <PortalSkillCard
              key={skill.key}
              skill={skill}
              index={index}
              onOpen={() => props.onOpenSkill(skill)}
            />
          ))}
        </div>
      ) : (
        <PortalEmpty
          label="没有匹配的 Skill"
          onAction={() => props.onSearch('')}
          actionLabel="清除搜索"
        />
      )}
    </main>
  );
}

function Workbench(props: Props) {
  const drafts = props.sessions.filter((item) => item.status !== 'completed');
  const ready = drafts.filter(
    (item) => item.status === 'ready_for_confirmation',
  );
  return (
    <main className="isk-portal-page skill-view-enter">
      <PageHeader
        title="工作台"
        description="聚合当前真实项目、待确认事项和最近更新。"
      />
      <div className="isk-stat-grid">
        <Stat
          label="我的 Skill"
          value={props.skills.length}
          note="当前仓库中的 Skill"
        />
        <Stat
          label="未完成草稿"
          value={drafts.length}
          note="可继续共创与生成"
        />
        <Stat label="待我确认" value={ready.length} note="需求已经整理完成" />
        <Stat
          label="已发布版本"
          value={
            props.skills.filter((skill) => skill.latestVersionId !== null)
              .length
          }
          note="具备可运行版本"
        />
      </div>
      <div className="isk-workbench-grid">
        <section className="isk-panel-card is-wide">
          <header>
            <div>
              <h2>等待我处理</h2>
              <p>{drafts.length} 项</p>
            </div>
          </header>
          {drafts.length ? (
            drafts.slice(0, 5).map((draft) => (
              <button
                type="button"
                className="isk-task-row"
                key={draft.id}
                onClick={() => props.onOpenDraft(draft)}
              >
                <span className={`isk-task-status is-${draft.status}`}>
                  <Clock3 size={15} />
                </span>
                <span>
                  <strong>{getSessionName(draft)}</strong>
                  <small>
                    {draft.status === 'ready_for_confirmation'
                      ? '内容已整理，等待确认生成'
                      : '继续补充需求与依据'}
                  </small>
                </span>
                <em>
                  {draft.status === 'ready_for_confirmation'
                    ? '待确认'
                    : '待完善'}
                </em>
                <ChevronRight size={15} />
              </button>
            ))
          ) : (
            <PortalEmpty label="当前没有待处理草稿" onAction={props.onNew} />
          )}
        </section>
        <section className="isk-panel-card">
          <header>
            <div>
              <h2>快速入口</h2>
              <p>常用工作流</p>
            </div>
          </header>
          <div className="isk-quick-grid">
            <button type="button" onClick={props.onNew}>
              <Plus size={17} />
              <span>
                <strong>创建 Skill</strong>
                <small>对话、材料或音视频</small>
              </span>
            </button>
            <button type="button" onClick={props.onOpenMySkills}>
              <Layers3 size={17} />
              <span>
                <strong>我的 Skill</strong>
                <small>运行与版本管理</small>
              </span>
            </button>
            <button type="button" onClick={props.onOpenPipeline}>
              <GitBranch size={17} />
              <span>
                <strong>开发管线</strong>
                <small>查看版本与阶段</small>
              </span>
            </button>
            <button type="button" onClick={props.onOpenReview}>
              <BadgeCheck size={17} />
              <span>
                <strong>审核中心</strong>
                <small>处理待确认草稿</small>
              </span>
            </button>
          </div>
        </section>
        <section className="isk-panel-card is-full">
          <header>
            <div>
              <h2>最近 Skill</h2>
              <p>按更新时间排列</p>
            </div>
          </header>
          <div className="isk-compact-skills">
            {props.skills.slice(0, 6).map((skill) => (
              <button
                type="button"
                key={skill.key}
                onClick={() => props.onOpenSkill(skill)}
              >
                <span>
                  <Sparkles size={15} />
                </span>
                <strong>{skill.name}</strong>
                <small>
                  {skill.latestVersionNumber
                    ? `v${skill.latestVersionNumber}`
                    : '暂无正常版本'}
                </small>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Pipeline(props: Props) {
  return (
    <main className="isk-portal-page skill-view-enter">
      <PageHeader
        title="开发管线"
        description="查看每个 Skill 的可运行版本与下一步工作。"
        action={
          <button className="isk-primary-action" onClick={props.onNew}>
            <Plus size={15} />
            新建 Skill
          </button>
        }
      />
      <div className="isk-pipeline-list">
        {props.skills.length ? (
          props.skills.map((skill) => {
            const hasVersion = Boolean(skill.latestVersionId);
            return (
              <article key={skill.key}>
                <header>
                  <div>
                    <span>
                      <GitBranch size={16} />
                    </span>
                    <div>
                      <strong>{skill.name}</strong>
                      <small>
                        {hasVersion
                          ? `最新版本 v${skill.latestVersionNumber}`
                          : '等待生成首个正常版本'}
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onOpenVersions(skill)}
                  >
                    版本管理
                  </button>
                </header>
                <div className="isk-stage-track">
                  {stageLabels.map((stage, index) => {
                    const done = hasVersion && index < 2;
                    const active = hasVersion ? index === 2 : index === 0;
                    return (
                      <span
                        key={stage}
                        className={`${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
                      >
                        <i>{done ? <Check size={11} /> : index + 1}</i>
                        <em>{stage}</em>
                      </span>
                    );
                  })}
                </div>
              </article>
            );
          })
        ) : (
          <PortalEmpty label="还没有进入管线的 Skill" onAction={props.onNew} />
        )}
      </div>
    </main>
  );
}

function ReviewCenter(props: Props) {
  const pending = props.sessions.filter(
    (session) => session.status !== 'completed',
  );
  return (
    <main className="isk-portal-page skill-view-enter">
      <PageHeader
        title="审核中心"
        description="集中处理共创草稿的确认、失败重试与补充事项。"
      />
      <div className="isk-review-summary">
        <span>
          <b>
            {
              pending.filter((item) => item.status === 'ready_for_confirmation')
                .length
            }
          </b>
          待确认
        </span>
        <span>
          <b>{pending.filter((item) => item.status === 'collecting').length}</b>
          待完善
        </span>
        <span>
          <b>{pending.filter((item) => item.status === 'failed').length}</b>
          需重试
        </span>
      </div>
      <section className="isk-panel-card isk-review-queue">
        <header>
          <div>
            <h2>当前队列</h2>
            <p>{pending.length} 项真实草稿</p>
          </div>
        </header>
        {pending.length ? (
          pending.map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => props.onOpenDraft(session)}
            >
              <span className={`isk-review-icon is-${session.status}`}>
                {session.status === 'ready_for_confirmation' ? (
                  <BadgeCheck size={18} />
                ) : (
                  <CircleDashed size={18} />
                )}
              </span>
              <span>
                <strong>{getSessionName(session)}</strong>
                <small>
                  更新于 {new Date(session.updated_at).toLocaleString('zh-CN')}
                </small>
              </span>
              <em>
                {session.status === 'ready_for_confirmation'
                  ? '待确认'
                  : session.status === 'failed'
                    ? '需重试'
                    : '待完善'}
              </em>
              <ChevronRight size={15} />
            </button>
          ))
        ) : (
          <PortalEmpty label="审核队列为空" onAction={props.onNew} />
        )}
      </section>
    </main>
  );
}

function PortalSkillCard({
  skill,
  index,
  onOpen,
}: {
  skill: RepositorySkill;
  index: number;
  onOpen: () => void;
}) {
  return (
    <article className={`isk-portal-skill is-tone-${index % 5}`}>
      <div>
        <span>
          <Sparkles size={17} />
        </span>
        <em>Skill</em>
      </div>
      <h3>{skill.name}</h3>
      <p>{skill.description || '可运行、试用并持续优化的教育 Skill。'}</p>
      <footer>
        <span>
          <Star size={13} fill="currentColor" />
          {skill.latestVersionNumber ? `v${skill.latestVersionNumber}` : '草案'}
        </span>
        <button type="button" onClick={onOpen}>
          打开使用
        </button>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <article className="isk-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function PortalEmpty({
  label,
  onAction,
  actionLabel = '新建 Skill',
}: {
  label: string;
  onAction: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="isk-portal-empty">
      <Sparkles size={20} />
      <span>{label}</span>
      <button type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
