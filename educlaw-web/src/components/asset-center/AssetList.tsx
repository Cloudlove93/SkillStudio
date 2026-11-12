import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, RotateCw } from 'lucide-react';
import {
  selectAssetPage,
  type AssetEntry,
  type AssetListState,
} from './asset-center-state';

export function AssetList<T extends AssetEntry>({
  items,
  state,
  onChange,
  loading,
  error,
  onRetry,
  renderItem,
}: {
  items: T[];
  state: AssetListState;
  onChange: (state: Partial<AssetListState>) => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
  renderItem: (item: T) => ReactNode;
}) {
  const page = selectAssetPage(items, state);
  return (
    <>
      <div className="asset-toolbar">
        <label className="asset-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索资产</span>
          <input
            type="search"
            placeholder="搜索名称或描述"
            value={state.query}
            onChange={(e) => onChange({ query: e.target.value, page: 1 })}
          />
        </label>
        <label>
          状态
          <select
            aria-label="资产状态"
            value={state.filter}
            onChange={(e) =>
              onChange({
                filter: e.target.value as AssetListState['filter'],
                page: 1,
              })
            }
          >
            <option value="all">全部状态</option>
            <option value="ready">可使用</option>
            <option value="attention">待配置</option>
          </select>
        </label>
        <label>
          排序
          <select
            aria-label="排序方式"
            value={state.sort}
            onChange={(e) =>
              onChange({
                sort: e.target.value as AssetListState['sort'],
                page: 1,
              })
            }
          >
            <option value="updated">最近更新</option>
            <option value="oldest">最早更新</option>
            <option value="name">名称</option>
          </select>
        </label>
        <button
          type="button"
          className="asset-icon-button"
          title="刷新资产"
          aria-label="刷新资产"
          onClick={onRetry}
          disabled={loading}
        >
          <RotateCw size={17} />
        </button>
      </div>
      {loading ? (
        <p className="asset-empty" role="status">
          正在加载资产…
        </p>
      ) : error ? (
        <div className="asset-error" role="alert">
          {error}
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </div>
      ) : (
        <>
          <p className="asset-count" role="status">
            共 {page.total} 项
          </p>
          {page.items.length ? (
            <div className="asset-grid">{page.items.map(renderItem)}</div>
          ) : (
            <div className="asset-empty">
              <h2>{items.length ? '没有匹配的资产' : '暂无资产'}</h2>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      query: '',
                      filter: 'all',
                      sort: 'updated',
                      page: 1,
                    })
                  }
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
          <nav className="asset-pagination" aria-label="资产分页">
            <button
              type="button"
              aria-label="上一页"
              title="上一页"
              disabled={page.page <= 1}
              onClick={() => onChange({ page: page.page - 1 })}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              第 {page.page} / {page.pageCount} 页
            </span>
            <button
              type="button"
              aria-label="下一页"
              title="下一页"
              disabled={page.page >= page.pageCount}
              onClick={() => onChange({ page: page.page + 1 })}
            >
              <ChevronRight size={18} />
            </button>
          </nav>
        </>
      )}
    </>
  );
}
