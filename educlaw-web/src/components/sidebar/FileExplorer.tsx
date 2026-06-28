import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ChevronRight,
  File,
  Folder,
  RotateCw,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  FileCode,
  FileText,
  FileJson,
  FileImage,
  FileType,
  Upload,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PremiumPill } from '@/components/ui/premium';
import {
  listFiles,
  createFile,
  createDir,
  renamePath,
  deletePath,
  uploadFiles,
  uploadFilesWithPaths,
  type FileEntry,
} from '../../api/manager';
import { useT, type MessageKey } from '../../i18n';
import { useUIStore } from '../../stores/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileOps {
  listFiles: (dirPath: string) => Promise<FileEntry[]>;
  createFile: (filePath: string) => Promise<void>;
  createDir: (dirPath: string) => Promise<void>;
  renamePath: (oldPath: string, newPath: string) => Promise<void>;
  deletePath: (targetPath: string) => Promise<void>;
  uploadFiles: (dirPath: string, files: globalThis.File[]) => Promise<void>;
  uploadFilesWithPaths?: (
    dirPath: string,
    items: { file: globalThis.File; relativePath: string }[],
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<void>;
}

type UploadState = {
  uploading: boolean;
  count: number;
  progress: number; // 0-100
  done: boolean;
};

interface TreeNode extends FileEntry {
  path: string;
  children?: TreeNode[];
  loaded?: boolean;
}

type ContextTarget = {
  node: TreeNode | null;
  x: number;
  y: number;
};

type InlineEdit =
  | {
      parentPath: string;
      kind: 'file' | 'directory';
    }
  | {
      renamePath: string;
      oldName: string;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all visible (expanded) node paths in display order */
function collectVisiblePaths(nodes: TreeNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.loaded && node.children) {
      result.push(...collectVisiblePaths(node.children));
    }
  }
  return result;
}

/** Get parent dir from a path */
function parentDir(p: string): string {
  return p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '.';
}

/** Collect unique parent dirs that need reloading after batch delete */
function uniqueParentDirs(paths: Set<string>): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) dirs.add(parentDir(p));
  return dirs;
}

// ---------------------------------------------------------------------------
// File icon helper
// ---------------------------------------------------------------------------

function fileIconFor(name: string): { icon: typeof File; color: string } {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { icon: FileCode, color: 'text-sky-500' };
    case 'py':
    case 'go':
    case 'rs':
    case 'rb':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return { icon: FileCode, color: 'text-emerald-500' };
    case 'json':
    case 'jsonc':
    case 'json5':
      return { icon: FileJson, color: 'text-amber-500' };
    case 'md':
    case 'mdx':
    case 'txt':
    case 'rst':
      return { icon: FileText, color: 'text-violet-500' };
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'env':
      return { icon: FileType, color: 'text-orange-500' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return { icon: FileImage, color: 'text-pink-500' };
    case 'css':
    case 'scss':
    case 'less':
      return { icon: FileCode, color: 'text-fuchsia-500' };
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return { icon: FileCode, color: 'text-orange-500' };
    default:
      return { icon: File, color: 'text-muted-foreground/70' };
  }
}

// ---------------------------------------------------------------------------
// Folder drag helpers (webkitGetAsEntry)
// ---------------------------------------------------------------------------

async function readEntryRecursive(
  entry: FileSystemEntry,
  basePath: string,
): Promise<{ file: File; relativePath: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [{ file, relativePath: basePath + entry.name }];
  }
  if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries may not return all entries in one call - loop until empty
    const allEntries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        dirReader.readEntries(resolve, reject),
      );
      allEntries.push(...batch);
    } while (batch.length > 0);

    const results: { file: File; relativePath: string }[] = [];
    for (const child of allEntries) {
      results.push(
        ...(await readEntryRecursive(child, basePath + entry.name + '/')),
      );
    }
    return results;
  }
  return [];
}

/** Extract files from a drop event, supporting folder structure via webkitGetAsEntry */
async function extractDropItems(
  dataTransfer: DataTransfer,
): Promise<{ file: File; relativePath: string }[] | null> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) return null;

  // Check if webkitGetAsEntry is available and any item is a directory
  const entries: FileSystemEntry[] = [];
  let hasEntry = false;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
      hasEntry = true;
    }
  }

  if (hasEntry && entries.length > 0) {
    const results: { file: File; relativePath: string }[] = [];
    for (const entry of entries) {
      results.push(...(await readEntryRecursive(entry, '')));
    }
    return results;
  }

  // Fallback: plain file list (no relative path info)
  return null;
}

// ---------------------------------------------------------------------------
// InlineInput
// ---------------------------------------------------------------------------

function InlineInput({
  depth,
  defaultValue,
  icon,
  onConfirm,
  onCancel,
}: {
  depth: number;
  defaultValue: string;
  icon: React.ReactNode;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = defaultValue.lastIndexOf('.');
    if (dot > 0) {
      input.setSelectionRange(0, dot);
    } else {
      input.select();
    }
  }, [defaultValue]);

  const submit = () => {
    const v = ref.current?.value.trim();
    if (v) onConfirm(v);
    else onCancel();
  };

  return (
    <div
      data-tree-row
      className="mx-1 flex items-center rounded-[14px] border border-primary/18 bg-primary-soft px-2.5 py-1.5 shadow-sm"
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <span className="size-3 shrink-0 mr-1" />
      {icon}
      <input
        ref={ref}
        defaultValue={defaultValue}
        className="min-w-0 flex-1 rounded-[10px] border border-border bg-background px-2.5 py-1 text-xs font-normal text-foreground outline-none ring-1 ring-primary/12 transition focus:border-primary focus:ring-primary/20"
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextMenu
// ---------------------------------------------------------------------------

function ContextMenu({
  target,
  multiCount,
  onAction,
  onClose,
  t,
}: {
  target: ContextTarget;
  multiCount: number;
  onAction: (action: string) => void;
  onClose: () => void;
  t: (key: MessageKey) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const isDir = target.node === null || target.node.type === 'directory';

  const items: {
    label: string;
    action: string;
    icon: React.ReactNode;
    danger?: boolean;
  }[] = [];

  if (isDir) {
    items.push(
      {
        label: t('file.newFile'),
        action: 'new-file',
        icon: <FilePlus className="size-3 mr-2" />,
      },
      {
        label: t('file.newFolder'),
        action: 'new-dir',
        icon: <FolderPlus className="size-3 mr-2" />,
      },
    );
  }

  if (target.node) {
    items.push({
      label: t('file.rename'),
      action: 'rename',
      icon: <Pencil className="size-3 mr-2" />,
    });
  }

  if (multiCount > 1) {
    items.push({
      label: t('file.deleteSelected').replace('{n}', String(multiCount)),
      action: 'delete-selected',
      icon: <Trash2 className="size-3 mr-2" />,
      danger: true,
    });
  } else if (target.node) {
    items.push({
      label: t('file.delete'),
      action: 'delete',
      icon: <Trash2 className="size-3 mr-2" />,
      danger: true,
    });
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[176px] rounded-[16px] border border-border/70 bg-popover p-1.5 shadow-md animate-in fade-in zoom-in-95"
      style={{ left: target.x, top: target.y }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          className={`flex w-full items-center rounded-xl px-3 py-2 text-xs transition-all duration-150 hover:bg-muted ${
            item.danger
              ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
              : 'text-popover-foreground'
          }`}
          onClick={() => {
            onAction(item.action);
            onClose();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileTreeNode
// ---------------------------------------------------------------------------

function FileTreeNode({
  node,
  depth,
  selected,
  inlineEdit,
  dropTarget,
  onToggle,
  onSelect,
  onContext,
  onNodeAction,
  onDrop,
  onDragOver,
  onDragLeave,
  onInlineConfirm,
  onInlineCancel,
  t,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<string>;
  inlineEdit: InlineEdit | null;
  dropTarget: string | null;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode, e: React.MouseEvent) => void;
  onContext: (e: React.MouseEvent, node: TreeNode) => void;
  onNodeAction: (action: string, node: TreeNode) => void;
  onDrop: (e: React.DragEvent, dirPath: string) => void;
  onDragOver: (e: React.DragEvent, dirPath: string) => void;
  onDragLeave: () => void;
  onInlineConfirm: (value: string) => void;
  onInlineCancel: () => void;
  t: (key: MessageKey) => string;
}) {
  const isDir = node.type === 'directory';
  const isOpen = isDir && node.loaded && node.children !== undefined;
  const isSelected = selected.has(node.path);
  const isDropTarget = dropTarget === node.path;

  const isRenaming =
    inlineEdit &&
    'renamePath' in inlineEdit &&
    inlineEdit.renamePath === node.path;

  const showInlineCreate =
    isOpen &&
    inlineEdit &&
    'parentPath' in inlineEdit &&
    inlineEdit.parentPath === node.path;

  const { icon: FileIcon, color: fileColor } = isDir
    ? { icon: Folder, color: isOpen ? 'text-blue-400' : 'text-blue-500' }
    : fileIconFor(node.name);

  return (
    <>
      {isRenaming ? (
        <InlineInput
          depth={depth}
          defaultValue={'renamePath' in inlineEdit ? inlineEdit.oldName : ''}
          icon={
            <FileIcon className={`size-3.5 shrink-0 mr-1.5 ${fileColor}`} />
          }
          onConfirm={onInlineConfirm}
          onCancel={onInlineCancel}
        />
      ) : (
        <div
          data-tree-row
          className={`group relative mx-1 flex cursor-pointer items-center rounded-[14px] px-2 py-[6px] text-xs transition-all duration-150 ${
            isDropTarget
              ? 'bg-primary-soft text-foreground ring-1 ring-inset ring-primary/25 shadow-sm'
              : isSelected
                ? 'bg-primary-soft text-foreground ring-1 ring-primary/18 shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          style={{ paddingLeft: depth * 14 + 6 }}
          onClick={(e) => onSelect(node, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContext(e, node);
          }}
          onDragOver={isDir ? (e) => onDragOver(e, node.path) : undefined}
          onDragLeave={isDir ? onDragLeave : undefined}
          onDrop={isDir ? (e) => onDrop(e, node.path) : undefined}
        >
          {isDir ? (
            <ChevronRight
              className={`size-3 shrink-0 mr-0.5 text-muted-foreground/50 transition-transform duration-150 ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          ) : (
            <span className="size-3 shrink-0 mr-0.5" />
          )}
          <FileIcon className={`size-3.5 shrink-0 mr-1.5 ${fileColor}`} />
          <span
            className={`flex-1 min-w-0 truncate ${isSelected ? 'font-medium' : ''}`}
          >
            {node.name}
          </span>
          {/* Hover action buttons - absolutely positioned to right edge */}
          <span className="absolute right-2 top-0 bottom-0 hidden items-center gap-px rounded-r-md pl-4 pr-0.5 group-hover:flex">
            <span className="flex items-center gap-px rounded-[12px] border border-border bg-background px-1 py-0.5 shadow-sm">
              {isDir && (
                <>
                  <button
                    className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    title={t('file.newFile')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNodeAction('new-file', node);
                    }}
                  >
                    <FilePlus className="size-3" />
                  </button>
                  <button
                    className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    title={t('file.newFolder')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNodeAction('new-dir', node);
                    }}
                  >
                    <FolderPlus className="size-3" />
                  </button>
                </>
              )}
              <button
                className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                title={t('file.rename')}
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeAction('rename', node);
                }}
              >
                <Pencil className="size-3" />
              </button>
              <button
                className="rounded-md p-1 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={t('file.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeAction('delete', node);
                }}
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          </span>
        </div>
      )}

      {showInlineCreate && (
        <InlineInput
          depth={depth + 1}
          defaultValue=""
          icon={
            (
              'parentPath' in inlineEdit
                ? inlineEdit.kind === 'directory'
                : false
            ) ? (
              <Folder className="size-3 shrink-0 mr-1.5 text-blue-500" />
            ) : (
              <File className="size-3 shrink-0 mr-1.5" />
            )
          }
          onConfirm={onInlineConfirm}
          onCancel={onInlineCancel}
        />
      )}

      {isOpen &&
        node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            inlineEdit={inlineEdit}
            dropTarget={dropTarget}
            onToggle={onToggle}
            onSelect={onSelect}
            onContext={onContext}
            onNodeAction={onNodeAction}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onInlineConfirm={onInlineConfirm}
            onInlineCancel={onInlineCancel}
            t={t}
          />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// FileExplorer (main)
// ---------------------------------------------------------------------------

export default function FileExplorer({
  agentId,
  fileOps,
  style,
  onFileSelect,
  onDeselect,
  readonly,
}: {
  agentId?: string;
  fileOps?: FileOps;
  style?: React.CSSProperties;
  onFileSelect?: (path: string) => void;
  onDeselect?: () => void;
  readonly?: boolean;
}) {
  const t = useT();
  const { openFilePath, setOpenFilePath } = useUIStore();

  /** Close the file viewer if the deleted path matches or contains the currently open file */
  const closeViewerIfAffected = useCallback(
    (deletedPaths: Iterable<string>) => {
      if (!openFilePath) return;
      for (const p of deletedPaths) {
        if (openFilePath === p || openFilePath.startsWith(p + '/')) {
          setOpenFilePath(null);
          return;
        }
      }
    },
    [openFilePath, setOpenFilePath],
  );

  // Build ops: use provided fileOps, or construct from agentId
  const ops: FileOps = useMemo(() => {
    if (fileOps) return fileOps;
    const id = agentId!;
    return {
      listFiles: (dirPath) => listFiles(id, dirPath),
      createFile: (filePath) => createFile(id, filePath),
      createDir: (dirPath) => createDir(id, dirPath),
      renamePath: (oldP, newP) => renamePath(id, oldP, newP),
      deletePath: (targetPath) => deletePath(id, targetPath),
      uploadFiles: (dirPath, files) => uploadFiles(id, dirPath, files),
      uploadFilesWithPaths: (dirPath, items, onProgress) =>
        uploadFilesWithPaths(id, dirPath, items, onProgress),
    };
  }, [fileOps, agentId]);

  // Stable identity key for resetting state when the data source changes
  const opsKey = agentId ?? (fileOps ? 'custom' : '');

  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextTarget | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({
    uploading: false,
    count: 0,
    progress: 0,
    done: false,
  });
  const [dragOverlay, setDragOverlay] = useState(false);
  const dragCounter = useRef(0);

  // Reset tree when data source changes
  useEffect(() => {
    setRoots([]);
    setLoaded(false);
    setSelected(new Set());
    setLastClicked(null);
    setCtxMenu(null);
    setInlineEdit(null);
  }, [opsKey]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- data helpers ----

  const loadDir = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      const entries = await ops.listFiles(dirPath);
      return entries.map((e) => ({
        ...e,
        path: dirPath === '.' ? e.name : `${dirPath}/${e.name}`,
      }));
    },
    [ops],
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const nodes = await loadDir('.');
      setRoots(nodes);
      setLoaded(true);
    } catch {
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [loadDir]);

  if (!loaded && !loading) loadRoot();

  // Auto-refresh when agent modifies files (only for agent mode)
  const refreshCounter = useUIStore((s) =>
    agentId ? (s.fileRefreshCounters.get(agentId) ?? 0) : 0,
  );
  useEffect(() => {
    if (!agentId || refreshCounter === 0) return;
    const t = setTimeout(loadRoot, 500);
    return () => clearTimeout(t);
  }, [refreshCounter, loadRoot, agentId]);

  const reloadDir = useCallback(
    async (dirPath: string, tree: TreeNode[]): Promise<TreeNode[]> => {
      const reloadNodeChildren = async (
        currentDirPath: string,
        currentTree: TreeNode[],
      ): Promise<TreeNode[]> => {
        if (currentDirPath === '.') return loadDir('.');
        const result: TreeNode[] = [];
        for (const node of currentTree) {
          if (node.path === currentDirPath && node.type === 'directory') {
            const children = await loadDir(node.path);
            result.push({ ...node, children, loaded: true });
          } else if (node.children) {
            result.push({
              ...node,
              children: await reloadNodeChildren(currentDirPath, node.children),
            });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      return reloadNodeChildren(dirPath, tree);
    },
    [loadDir],
  );

  // ---- toggle expand/collapse ----

  const toggleNode = useCallback(
    async (target: TreeNode) => {
      const toggle = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === target.path) {
            if (node.loaded) {
              result.push({ ...node, children: undefined, loaded: false });
            } else {
              const children = await loadDir(node.path);
              result.push({ ...node, children, loaded: true });
            }
          } else if (node.children) {
            result.push({ ...node, children: await toggle(node.children) });
          } else {
            result.push(node);
          }
        }
        return result;
      };
      setRoots(await toggle(roots));
    },
    [roots, loadDir],
  );

  const ensureExpanded = useCallback(
    async (dirPath: string, tree: TreeNode[]): Promise<TreeNode[]> => {
      const expandNodeChildren = async (
        currentDirPath: string,
        currentTree: TreeNode[],
      ): Promise<TreeNode[]> => {
        if (currentDirPath === '.') return currentTree;
        const result: TreeNode[] = [];
        for (const node of currentTree) {
          if (
            node.path === currentDirPath &&
            node.type === 'directory' &&
            !node.loaded
          ) {
            const children = await loadDir(node.path);
            result.push({ ...node, children, loaded: true });
          } else if (node.children) {
            result.push({
              ...node,
              children: await expandNodeChildren(currentDirPath, node.children),
            });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      return expandNodeChildren(dirPath, tree);
    },
    [loadDir],
  );

  // ---- selection (click / ctrl+click / shift+click) ----

  const handleSelect = useCallback(
    (node: TreeNode, e: React.MouseEvent) => {
      const isDir = node.type === 'directory';

      if (e.metaKey || e.ctrlKey) {
        // Toggle this item in selection
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(node.path)) next.delete(node.path);
          else next.add(node.path);
          return next;
        });
        setLastClicked(node.path);
        return;
      }

      if (e.shiftKey && lastClicked) {
        // Range select
        const visible = collectVisiblePaths(roots);
        const a = visible.indexOf(lastClicked);
        const b = visible.indexOf(node.path);
        if (a >= 0 && b >= 0) {
          const [start, end] = a < b ? [a, b] : [b, a];
          const range = visible.slice(start, end + 1);
          setSelected(new Set(range));
        }
        return;
      }

      // Normal click - single select
      setSelected(new Set([node.path]));
      setLastClicked(node.path);

      if (isDir) {
        toggleNode(node);
      } else {
        onFileSelect?.(node.path);
      }
    },
    [lastClicked, roots, toggleNode, onFileSelect],
  );

  // Clear selection when clicking background
  const handleBgClick = useCallback(
    (e: React.MouseEvent) => {
      // Clicked on a tree row or inline input - ignore
      if ((e.target as HTMLElement).closest('[data-tree-row]')) return;
      setSelected(new Set());
      setLastClicked(null);
      onDeselect?.();
    },
    [onDeselect],
  );

  // ---- context menu ----

  const handleContext = useCallback(
    (e: React.MouseEvent, node: TreeNode) => {
      // If right-clicked node is not in current selection, select only it
      if (!selected.has(node.path)) {
        setSelected(new Set([node.path]));
        setLastClicked(node.path);
      }
      setCtxMenu({ node, x: e.clientX, y: e.clientY });
    },
    [selected],
  );

  const handleBgContext = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tree-node]')) return;
    e.preventDefault();
    setSelected(new Set());
    setCtxMenu({ node: null, x: e.clientX, y: e.clientY });
  }, []);

  // ---- batch delete ----

  const handleDeleteSelected = useCallback(
    async (currentRoots: TreeNode[]) => {
      if (selected.size === 0) return;
      const count = selected.size;
      if (
        !window.confirm(
          t('file.confirmDeleteSelected').replace('{n}', String(count)),
        )
      )
        return;

      setDeleting(true);
      try {
        // Delete all selected items (skip children of selected directories since rm -rf handles them)
        const toDelete = [...selected].filter(
          (p) =>
            ![...selected].some(
              (other) => other !== p && p.startsWith(other + '/'),
            ),
        );

        await Promise.all(toDelete.map((p) => ops.deletePath(p)));

        // Reload affected parent directories
        const parents = uniqueParentDirs(new Set(toDelete));
        let tree = currentRoots;
        for (const dir of parents) {
          tree = await reloadDir(dir, tree);
        }
        setRoots(tree);
        setSelected(new Set());
        setLastClicked(null);
        closeViewerIfAffected(toDelete);
      } finally {
        setDeleting(false);
      }
    },
    [selected, ops, reloadDir, t, closeViewerIfAffected],
  );

  // ---- shared action handler ----

  const executeAction = useCallback(
    async (action: string, target: TreeNode | null) => {
      if (action === 'delete-selected') {
        await handleDeleteSelected(roots);
        return;
      }

      if (action === 'new-file' || action === 'new-dir') {
        const parentPath = target ? target.path : '.';
        if (parentPath !== '.') {
          setRoots(await ensureExpanded(parentPath, roots));
        }
        setInlineEdit({
          parentPath,
          kind: action === 'new-dir' ? 'directory' : 'file',
        });
        return;
      }

      if (action === 'rename' && target) {
        setInlineEdit({ renamePath: target.path, oldName: target.name });
        return;
      }

      if (action === 'delete' && target) {
        const label =
          target.type === 'directory' ? t('file.folder') : t('file.file');
        const suffix =
          target.type === 'directory' ? t('file.confirmDeleteDirSuffix') : '';
        if (
          !window.confirm(
            t('file.confirmDelete')
              .replace('{label}', label)
              .replace('{name}', target.name) + suffix,
          )
        )
          return;
        await ops.deletePath(target.path);
        const dir = parentDir(target.path);
        setRoots(await reloadDir(dir, roots));
        setSelected((prev) => {
          const n = new Set(prev);
          n.delete(target.path);
          return n;
        });
        closeViewerIfAffected([target.path]);
      }
    },
    [
      roots,
      ops,
      ensureExpanded,
      reloadDir,
      handleDeleteSelected,
      t,
      closeViewerIfAffected,
    ],
  );

  const handleAction = useCallback(
    (action: string) => executeAction(action, ctxMenu?.node ?? null),
    [executeAction, ctxMenu],
  );

  const handleNodeAction = useCallback(
    (action: string, node: TreeNode) => executeAction(action, node),
    [executeAction],
  );

  // ---- inline edit confirm ----

  const handleInlineConfirm = useCallback(
    async (value: string) => {
      if (!inlineEdit) return;

      if ('parentPath' in inlineEdit) {
        const parentPath = inlineEdit.parentPath;
        const fullPath = parentPath === '.' ? value : `${parentPath}/${value}`;
        if (inlineEdit.kind === 'directory') {
          await ops.createDir(fullPath);
        } else {
          await ops.createFile(fullPath);
        }
        const updated = await reloadDir(parentPath, roots);
        setRoots(updated);
        if (inlineEdit.kind === 'file') {
          setSelected(new Set([fullPath]));
          onFileSelect?.(fullPath);
        }
      } else {
        const oldPath = inlineEdit.renamePath;
        const dir = parentDir(oldPath);
        const newPath = dir === '.' ? value : `${dir}/${value}`;
        if (newPath !== oldPath) {
          await ops.renamePath(oldPath, newPath);
          const updated = await reloadDir(dir, roots);
          setRoots(updated);
          setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(oldPath)) {
              n.delete(oldPath);
              n.add(newPath);
            }
            return n;
          });
        }
      }

      setInlineEdit(null);
    },
    [inlineEdit, ops, roots, reloadDir, onFileSelect],
  );

  const handleInlineCancel = useCallback(() => setInlineEdit(null), []);

  // ---- keyboard: Delete / Backspace to delete selected ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selected.size === 0) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selected.size === 1) {
          const path = [...selected][0];
          // Find the node to get its name for the confirm message
          executeAction('delete', {
            path,
            name: path.split('/').pop()!,
            type: 'file',
          } as TreeNode);
        } else {
          handleDeleteSelected(roots);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selected, executeAction, handleDeleteSelected, roots]);

  // ---- drag & drop upload ----

  const handleDragOver = useCallback((e: React.DragEvent, dirPath: string) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(dirPath);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, dirPath: string) => {
      e.preventDefault();
      setDropTarget(null);
      setDragOverlay(false);
      dragCounter.current = 0;

      const dt = e.dataTransfer;
      if (!dt) return;

      // Capture plain files synchronously BEFORE any await - browser clears
      // DataTransfer after the event handler returns synchronously.
      const plainFiles = dt.files ? Array.from(dt.files) : [];

      // Try folder-aware extraction (webkitGetAsEntry) - must also start
      // synchronously to grab entry references before the DataTransfer is cleared.
      let entryItems: { file: File; relativePath: string }[] | null = null;
      if (ops.uploadFilesWithPaths) {
        entryItems = await extractDropItems(dt);
      }

      if (entryItems && entryItems.length > 0 && ops.uploadFilesWithPaths) {
        setUploadState({
          uploading: true,
          count: entryItems.length,
          progress: 0,
          done: false,
        });
        try {
          await ops.uploadFilesWithPaths(
            dirPath,
            entryItems,
            (loaded, total) => {
              setUploadState((prev) => ({
                ...prev,
                progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
              }));
            },
          );
          setUploadState({
            uploading: false,
            count: entryItems.length,
            progress: 100,
            done: true,
          });
        } catch {
          setUploadState({
            uploading: false,
            count: 0,
            progress: 0,
            done: false,
          });
        }
      } else if (plainFiles.length > 0) {
        // Fallback: use the synchronously-captured plain file list
        setUploadState({
          uploading: true,
          count: plainFiles.length,
          progress: 0,
          done: false,
        });
        try {
          await ops.uploadFiles(dirPath, plainFiles);
          setUploadState({
            uploading: false,
            count: plainFiles.length,
            progress: 100,
            done: true,
          });
        } catch {
          setUploadState({
            uploading: false,
            count: 0,
            progress: 0,
            done: false,
          });
        }
      } else {
        return; // Nothing to upload
      }

      // Reload the target directory
      if (dirPath === '.') {
        const nodes = await loadDir('.');
        setRoots(nodes);
      } else {
        setRoots(await reloadDir(dirPath, roots));
      }

      // Auto-hide success state after 2 seconds
      setTimeout(() => {
        setUploadState((prev) =>
          prev.done
            ? { uploading: false, count: 0, progress: 0, done: false }
            : prev,
        );
      }, 2000);
    },
    [ops, roots, loadDir, reloadDir],
  );

  // Root-level drop (dropping onto the background = root dir)
  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    // Always preventDefault so the browser fires the drop event, even
    // when hovering over a non-directory file row (which has no own handler).
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Only show root as drop target when not hovering over a specific tree row
    if (!(e.target as HTMLElement).closest('[data-tree-row]')) {
      setDropTarget('.');
    }
  }, []);

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if actually leaving the container
    if (
      containerRef.current &&
      !containerRef.current.contains(e.relatedTarget as Node)
    ) {
      setDropTarget(null);
      dragCounter.current = 0;
      setDragOverlay(false);
    }
  }, []);

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      // Reset overlay state on any drop
      setDragOverlay(false);
      dragCounter.current = 0;
      // If a directory row already handled this drop, skip
      if (e.defaultPrevented) return;
      handleDrop(e, '.');
    },
    [handleDrop],
  );

  // Drag overlay tracking (container-level)
  const handleContainerDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOverlay(true);
  }, []);

  // ---- file input upload ----

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const dirPath = '.';
      const plainFiles = Array.from(files);

      setUploadState({
        uploading: true,
        count: plainFiles.length,
        progress: 0,
        done: false,
      });
      try {
        await ops.uploadFiles(dirPath, plainFiles);
        setUploadState({
          uploading: false,
          count: plainFiles.length,
          progress: 100,
          done: true,
        });
      } catch {
        setUploadState({
          uploading: false,
          count: 0,
          progress: 0,
          done: false,
        });
      }

      // Reload root
      const nodes = await loadDir('.');
      setRoots(nodes);

      // Reset file input so the same file can be selected again
      e.target.value = '';

      // Auto-hide success state
      setTimeout(() => {
        setUploadState((prev) =>
          prev.done
            ? { uploading: false, count: 0, progress: 0, done: false }
            : prev,
        );
      }, 2000);
    },
    [ops, loadDir],
  );

  // ---- render ----

  const showRootInlineCreate =
    inlineEdit && 'parentPath' in inlineEdit && inlineEdit.parentPath === '.';

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full min-w-0 flex-col overflow-hidden transition-colors ${
        dropTarget === '.' ? 'bg-primary-soft/80' : ''
      }`}
      style={style}
      onClick={handleBgClick}
      onContextMenu={readonly ? undefined : handleBgContext}
      onDragOver={readonly ? undefined : handleRootDragOver}
      onDragLeave={readonly ? undefined : handleRootDragLeave}
      onDrop={readonly ? undefined : handleRootDrop}
      onDragEnter={readonly ? undefined : handleContainerDragEnter}
    >
      {/* Hidden file input for upload button */}
      {!readonly && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      )}

      {/* Header */}
      <div className="border-b border-border/70 bg-muted/30 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <div className="flex size-7 items-center justify-center rounded-[12px] bg-primary-soft text-primary">
                <Folder className="size-3.5" />
              </div>
              <span>{t('file.explorer')}</span>
              {selected.size > 1 && (
                <PremiumPill accent="blue">
                  {t('file.selected').replace('{n}', String(selected.size))}
                </PremiumPill>
              )}
            </div>
            <div className="mt-1 max-w-full break-words pl-9 text-[11px] text-muted-foreground/70">
              {t('file.dropHint')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-1 shadow-sm">
            {!readonly && selected.size > 1 && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDeleteSelected(roots)}
                disabled={deleting}
                title={t('file.deleteSelected').replace(
                  '{n}',
                  String(selected.size),
                )}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2
                  className={`size-3.5 ${deleting ? 'animate-pulse' : ''}`}
                />
              </Button>
            )}
            {!readonly && (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => fileInputRef.current?.click()}
                  title={t('file.upload')}
                  disabled={uploadState.uploading}
                >
                  <Upload
                    className={`size-3.5 ${uploadState.uploading ? 'animate-pulse' : ''}`}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    setInlineEdit({ parentPath: '.', kind: 'file' })
                  }
                  title={t('file.newFile')}
                >
                  <FilePlus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    setInlineEdit({ parentPath: '.', kind: 'directory' })
                  }
                  title={t('file.newFolder')}
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={loadRoot}
              title={t('file.refresh')}
              disabled={loading}
            >
              <RotateCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea
        className={`flex-1 ${uploadState.uploading || uploadState.done ? 'pb-8' : ''}`}
      >
        {showRootInlineCreate && (
          <InlineInput
            depth={0}
            defaultValue=""
            icon={
              (
                'parentPath' in inlineEdit
                  ? inlineEdit.kind === 'directory'
                  : false
              ) ? (
                <Folder className="size-3 shrink-0 mr-1.5 text-blue-500" />
              ) : (
                <File className="size-3 shrink-0 mr-1.5" />
              )
            }
            onConfirm={handleInlineConfirm}
            onCancel={handleInlineCancel}
          />
        )}

        {roots.length === 0 && loaded && !showRootInlineCreate && (
          <div className="flex flex-col items-center px-5 py-10 text-center text-muted-foreground/50">
            <div className="mb-3 flex size-12 items-center justify-center rounded-[16px] border border-border bg-background shadow-sm">
              <Folder className="size-5" />
            </div>
            <span className="max-w-full break-words text-sm font-medium text-foreground/80">
              {t('todo.workspaceReady')}
            </span>
            <span className="mt-1 max-w-[16rem] break-words text-xs">
              {t('file.emptyHint')}
            </span>
          </div>
        )}

        {roots.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selected={selected}
            inlineEdit={inlineEdit}
            dropTarget={dropTarget}
            onToggle={toggleNode}
            onSelect={handleSelect}
            onContext={handleContext}
            onNodeAction={handleNodeAction}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onInlineConfirm={handleInlineConfirm}
            onInlineCancel={handleInlineCancel}
            t={t}
          />
        ))}
      </ScrollArea>

      {!readonly && ctxMenu && (
        <ContextMenu
          target={ctxMenu}
          multiCount={selected.size}
          onAction={handleAction}
          onClose={() => setCtxMenu(null)}
          t={t}
        />
      )}

      {/* Drag overlay - covers the entire file explorer */}
      {dragOverlay && !readonly && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary-soft/70 pointer-events-none">
          <div className="rounded-[20px] border border-border bg-card px-6 py-5 text-center shadow-sm">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-[16px] bg-primary-soft text-primary">
              <Upload className="size-5" />
            </div>
            <div className="max-w-[16rem] break-words text-sm font-semibold text-foreground">
              {t('file.dropToUpload')}
            </div>
            <div className="mt-1 max-w-[16rem] break-words text-xs text-muted-foreground">
              {t('file.dropHint')}
            </div>
          </div>
        </div>
      )}

      {/* Upload progress bar - pinned to the bottom of the file explorer */}
      {(uploadState.uploading || uploadState.done) && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-30 flex items-center gap-2 border-t px-3 py-2 text-xs transition-all duration-300 ${
            uploadState.done
              ? 'border-emerald-500/25 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300'
              : 'border-border bg-card text-muted-foreground'
          }`}
        >
          {uploadState.done ? (
            <CheckCircle className="size-3.5 shrink-0" />
          ) : (
            <Upload className="size-3.5 shrink-0 animate-pulse" />
          )}
          <span className="flex-1 truncate">
            {uploadState.done
              ? `${t('file.uploadComplete')} (${uploadState.count})`
              : `${t('file.uploading')} ${uploadState.count} ${t('file.files')}...`}
          </span>
          {!uploadState.done && (
            <span className="shrink-0 tabular-nums">
              {uploadState.progress}%
            </span>
          )}
          {!uploadState.done && (
            <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
