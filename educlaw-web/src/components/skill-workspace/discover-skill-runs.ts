/** Recover sidebar activity without admitting more than four concurrent reads. */
export async function discoverActiveSkillRuns(
  threadIds: string[],
  isActive: (id: string) => Promise<boolean>,
  onActive: (id: string) => void,
  isCurrent: () => boolean,
) {
  for (let offset = 0; offset < threadIds.length && isCurrent(); offset += 4) {
    const batch = threadIds.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(isActive));
    if (!isCurrent()) return;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) onActive(batch[index]);
    });
  }
}
