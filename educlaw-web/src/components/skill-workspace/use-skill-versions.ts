import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillVersionListResult } from '@educlaw/shared';
import { toast } from 'sonner';
import { liteApi } from '../../api/lite-api';

const empty: SkillVersionListResult = {
  items: [],
  currentVersionId: null,
  currentPackageVersionId: null,
  nextCursor: null,
};

/** Owns one Skill's version list; refreshes and page requests are generation-scoped. */
export function useSkillVersions(
  token: string,
  packageId?: string,
  skillId?: string,
) {
  const key = JSON.stringify([token, packageId, skillId]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const generation = useRef(0);
  const paging = useRef(false);
  const [state, setState] = useState({
    key: '',
    data: empty,
    loading: false,
    loadingMore: false,
  });
  const data = state.key === key ? state.data : empty;
  const reload = useCallback(async () => {
    if (keyRef.current !== key) return;
    const request = ++generation.current;
    paging.current = false;
    const valid = () =>
      generation.current === request && keyRef.current === key;
    setState({
      key,
      data: empty,
      loading: !!packageId && !!skillId,
      loadingMore: false,
    });
    if (!packageId || !skillId) return;
    try {
      const page = await liteApi.listSkillVersions(token, packageId, skillId, {
        includeDiscarded: true,
        limit: 100,
      });
      if (!valid()) return;
      if (
        page.currentVersionId &&
        !page.items.some((v) => v.id === page.currentVersionId)
      ) {
        const current = await liteApi.getSkillVersionDetail(
          token,
          packageId,
          page.currentVersionId,
        );
        if (!valid()) return;
        page.items = [...page.items, current];
      }
      setState({ key, data: page, loading: false, loadingMore: false });
    } catch (error) {
      if (!valid()) return;
      toast.error(error instanceof Error ? error.message : '版本加载失败');
      setState({ key, data: empty, loading: false, loadingMore: false });
    }
  }, [key, token, packageId, skillId]);
  useEffect(() => {
    void reload();
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, [reload]);
  const loadMore = useCallback(async () => {
    if (
      !packageId ||
      !skillId ||
      !data.nextCursor ||
      paging.current ||
      state.loading ||
      keyRef.current !== key
    )
      return;
    const request = generation.current;
    const valid = () =>
      generation.current === request && keyRef.current === key;
    paging.current = true;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await liteApi.listSkillVersions(token, packageId, skillId, {
        includeDiscarded: true,
        limit: 100,
        cursor: data.nextCursor,
      });
      if (!valid()) return;
      if (
        page.currentPackageVersionId !== data.currentPackageVersionId ||
        page.currentVersionId !== data.currentVersionId
      ) {
        await reload();
        return;
      }
      setState((s) => ({
        ...s,
        data: {
          ...s.data,
          items: [
            ...new Map(
              [...s.data.items, ...page.items].map((v) => [v.id, v]),
            ).values(),
          ],
          nextCursor: page.nextCursor,
        },
        loadingMore: false,
      }));
    } catch (error) {
      if (valid())
        toast.error(
          error instanceof Error ? error.message : '历史版本加载失败，请重试',
        );
    } finally {
      if (valid()) {
        paging.current = false;
        setState((s) => ({ ...s, loadingMore: false }));
      }
    }
  }, [key, token, packageId, skillId, data, state.loading, reload]);
  return {
    versions: data.items,
    currentVersionId: data.currentVersionId,
    currentPackageVersionId: data.currentPackageVersionId,
    loading: state.key !== key ? !!packageId && !!skillId : state.loading,
    loadingMore: state.key === key && state.loadingMore,
    hasMore: !!data.nextCursor,
    reload,
    loadMore,
  };
}
