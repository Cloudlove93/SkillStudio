import type { RepositorySkill } from './SkillRepositoryWorkspace';

export const REPOSITORY_PAGE_SIZE = 8;

export function filterRepositorySkills(
  skills: RepositorySkill[],
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return skills;
  return skills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query),
  );
}

export function clampRepositoryPage(page: number, itemCount: number) {
  const pageCount = Math.max(
    1,
    Math.ceil(itemCount / REPOSITORY_PAGE_SIZE),
  );
  return Math.min(Math.max(1, page), pageCount);
}

export function repositoryPageItems(
  skills: RepositorySkill[],
  page: number,
) {
  const safePage = clampRepositoryPage(page, skills.length);
  const start = (safePage - 1) * REPOSITORY_PAGE_SIZE;
  return skills.slice(start, start + REPOSITORY_PAGE_SIZE);
}

export function selectionForFilteredSkills(
  skills: RepositorySkill[],
  selected: Set<string>,
) {
  const next = new Set(selected);
  for (const skill of skills) next.add(skill.skillId);
  return next;
}

export function intersectSkillSelection(
  selected: Set<string>,
  skills: RepositorySkill[],
) {
  const available = new Set(skills.map((skill) => skill.skillId));
  return new Set([...selected].filter((skillId) => available.has(skillId)));
}

export function summarizeSkillDeletion(skills: RepositorySkill[]) {
  return {
    count: skills.length,
    names: skills.slice(0, 3).map((skill) => skill.name),
    remaining: Math.max(0, skills.length - 3),
  };
}
