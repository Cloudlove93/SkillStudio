export type PackageZipSecurityErrorCode =
  | 'TOO_MANY_ENTRIES'
  | 'UNSAFE_ENTRY_PATH'
  | 'DUPLICATE_ENTRY_PATH'
  | 'INVALID_ENTRY_METADATA'
  | 'ENCRYPTED_ENTRY'
  | 'ENTRY_TOO_LARGE'
  | 'ARCHIVE_TOO_LARGE'
  | 'SUSPICIOUS_COMPRESSION_RATIO'
  | 'INVALID_ENTRY_DATA'
  | 'INVALID_TEXT_ENCODING';

export class PackageZipSecurityError extends Error {
  readonly code: PackageZipSecurityErrorCode;

  constructor(code: PackageZipSecurityErrorCode, message: string) {
    super(message);
    this.name = 'PackageZipSecurityError';
    this.code = code;
  }
}

export interface PackageZipEntry {
  entryName: string;
  isDirectory: boolean;
  header: {
    size: number;
    compressedSize: number;
    encrypted?: boolean;
  };
  getData(): Buffer;
}

export interface PackageZipLimits {
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_PACKAGE_ZIP_LIMITS: Readonly<PackageZipLimits> = {
  maxEntries: 256,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
};

function fail(code: PackageZipSecurityErrorCode, message: string): never {
  throw new PackageZipSecurityError(code, message);
}

function assertPositiveLimit(value: number, name: keyof PackageZipLimits) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`ZIP limit ${name} must be a positive safe integer`);
  }
}

function validateLimits(limits: PackageZipLimits) {
  assertPositiveLimit(limits.maxEntries, 'maxEntries');
  assertPositiveLimit(
    limits.maxEntryUncompressedBytes,
    'maxEntryUncompressedBytes',
  );
  assertPositiveLimit(
    limits.maxTotalUncompressedBytes,
    'maxTotalUncompressedBytes',
  );
  if (!Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio <= 0) {
    throw new TypeError(
      'ZIP limit maxCompressionRatio must be a positive finite number',
    );
  }
}

function canonicalizeEntryPath(entryName: string) {
  if (
    entryName.length === 0 ||
    entryName.includes('\u0000') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    /^[a-zA-Z]:/.test(entryName)
  ) {
    fail('UNSAFE_ENTRY_PATH', `ZIP 中包含不安全的路径：${entryName}`);
  }

  const normalized = entryName.normalize('NFC');
  const segments = normalized.split('/');
  const pathSegments = normalized.endsWith('/') ? segments.slice(0, -1) : segments;
  if (
    pathSegments.length === 0 ||
    pathSegments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    fail('UNSAFE_ENTRY_PATH', `ZIP 中包含不安全的路径：${entryName}`);
  }

  return normalized.toLocaleLowerCase('en-US');
}

function readDeclaredSize(value: number, entryName: string, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'INVALID_ENTRY_METADATA',
      `ZIP 条目 ${entryName} 的 ${field} 元数据无效`,
    );
  }
  return value;
}

function preflightEntries(
  entries: readonly PackageZipEntry[],
  limits: PackageZipLimits,
) {
  validateLimits(limits);
  if (entries.length > limits.maxEntries) {
    fail(
      'TOO_MANY_ENTRIES',
      `ZIP 条目数超过限制（最多 ${limits.maxEntries} 个）`,
    );
  }

  const paths = new Set<string>();
  let totalDeclaredBytes = 0;

  for (const entry of entries) {
    const canonicalPath = canonicalizeEntryPath(entry.entryName);
    if (paths.has(canonicalPath)) {
      fail(
        'DUPLICATE_ENTRY_PATH',
        `ZIP 中包含重复路径：${entry.entryName}`,
      );
    }
    paths.add(canonicalPath);

    if (entry.header.encrypted) {
      fail('ENCRYPTED_ENTRY', `不支持加密的 ZIP 条目：${entry.entryName}`);
    }
    if (entry.isDirectory) continue;

    const uncompressedBytes = readDeclaredSize(
      entry.header.size,
      entry.entryName,
      'size',
    );
    const compressedBytes = readDeclaredSize(
      entry.header.compressedSize,
      entry.entryName,
      'compressedSize',
    );

    if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
      fail(
        'ENTRY_TOO_LARGE',
        `ZIP 条目 ${entry.entryName} 解压后超过单文件限制`,
      );
    }

    totalDeclaredBytes += uncompressedBytes;
    if (totalDeclaredBytes > limits.maxTotalUncompressedBytes) {
      fail('ARCHIVE_TOO_LARGE', 'ZIP 解压后的总大小超过限制');
    }

    if (
      uncompressedBytes > 0 &&
      (compressedBytes === 0 ||
        uncompressedBytes / compressedBytes > limits.maxCompressionRatio)
    ) {
      fail(
        'SUSPICIOUS_COMPRESSION_RATIO',
        `ZIP 条目 ${entry.entryName} 的压缩比异常`,
      );
    }
  }
}

export function createPackageZipReader(
  entries: readonly PackageZipEntry[],
  limits: PackageZipLimits = DEFAULT_PACKAGE_ZIP_LIMITS,
) {
  preflightEntries(entries, limits);
  const allowedEntries = new Set(entries);
  let totalReadBytes = 0;

  return {
    readText(entry: PackageZipEntry) {
      if (!allowedEntries.has(entry) || entry.isDirectory) {
        fail('INVALID_ENTRY_DATA', '尝试读取不属于当前 ZIP 的文件条目');
      }

      const data = entry.getData();
      if (!Buffer.isBuffer(data)) {
        fail('INVALID_ENTRY_DATA', `ZIP 条目 ${entry.entryName} 读取失败`);
      }
      if (data.length > limits.maxEntryUncompressedBytes) {
        fail(
          'ENTRY_TOO_LARGE',
          `ZIP 条目 ${entry.entryName} 的实际大小超过单文件限制`,
        );
      }

      totalReadBytes += data.length;
      if (totalReadBytes > limits.maxTotalUncompressedBytes) {
        fail('ARCHIVE_TOO_LARGE', 'ZIP 实际解压读取的总大小超过限制');
      }

      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(data);
      } catch {
        fail(
          'INVALID_TEXT_ENCODING',
          `ZIP 条目 ${entry.entryName} 不是有效的 UTF-8 文本`,
        );
      }
    },
  };
}
