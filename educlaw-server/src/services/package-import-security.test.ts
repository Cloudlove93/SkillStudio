import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  createPackageZipReader,
  type PackageZipEntry,
  type PackageZipLimits,
  PackageZipSecurityError,
} from './package-import-security.js';

const TEST_LIMITS: PackageZipLimits = {
  maxEntries: 3,
  maxEntryUncompressedBytes: 32,
  maxTotalUncompressedBytes: 48,
  maxCompressionRatio: 10,
};

function entry(
  entryName: string,
  content: string,
  overrides: Partial<PackageZipEntry> = {},
): PackageZipEntry {
  const data = Buffer.from(content, 'utf8');
  return {
    entryName,
    isDirectory: false,
    header: {
      size: data.length,
      compressedSize: Math.max(1, data.length),
      encrypted: false,
    },
    getData: () => data,
    ...overrides,
  };
}

function expectZipError(
  operation: () => unknown,
  code: PackageZipSecurityError['code'],
) {
  expect(operation).toThrowError(
    expect.objectContaining({
      name: 'PackageZipSecurityError',
      code,
    }),
  );
}

describe('package ZIP import security', () => {
  it.each([
    '../manifest.json',
    '/manifest.json',
    'C:/manifest.json',
    'skills\\math\\SKILL.md',
    'skills/../manifest.json',
    'skills/\u0000/manifest.json',
  ])('rejects unsafe entry path %s', (entryName) => {
    expectZipError(
      () => createPackageZipReader([entry(entryName, '{}')], TEST_LIMITS),
      'UNSAFE_ENTRY_PATH',
    );
  });

  it('rejects case-insensitive duplicate entry paths', () => {
    expectZipError(
      () =>
        createPackageZipReader(
          [entry('manifest.json', '{}'), entry('MANIFEST.JSON', '{}')],
          TEST_LIMITS,
        ),
      'DUPLICATE_ENTRY_PATH',
    );
  });

  it('rejects excessive entry counts before reading payloads', () => {
    let reads = 0;
    const entries = ['a', 'b', 'c', 'd'].map((name) =>
      entry(`${name}.json`, '{}', {
        getData: () => {
          reads += 1;
          return Buffer.from('{}');
        },
      }),
    );

    expectZipError(
      () => createPackageZipReader(entries, TEST_LIMITS),
      'TOO_MANY_ENTRIES',
    );
    expect(reads).toBe(0);
  });

  it('rejects declared per-entry, total, and compression-ratio limits before decompression', () => {
    expectZipError(
      () =>
        createPackageZipReader(
          [
            entry('manifest.json', '{}', {
              header: { size: 33, compressedSize: 20, encrypted: false },
            }),
          ],
          TEST_LIMITS,
        ),
      'ENTRY_TOO_LARGE',
    );

    expectZipError(
      () =>
        createPackageZipReader(
          [
            entry('manifest.json', '{}', {
              header: { size: 25, compressedSize: 20, encrypted: false },
            }),
            entry('snapshot.json', '{}', {
              header: { size: 25, compressedSize: 20, encrypted: false },
            }),
          ],
          TEST_LIMITS,
        ),
      'ARCHIVE_TOO_LARGE',
    );

    expectZipError(
      () =>
        createPackageZipReader(
          [
            entry('manifest.json', '{}', {
              header: { size: 21, compressedSize: 2, encrypted: false },
            }),
          ],
          TEST_LIMITS,
        ),
      'SUSPICIOUS_COMPRESSION_RATIO',
    );
  });

  it('rejects encrypted entries', () => {
    expectZipError(
      () =>
        createPackageZipReader(
          [
            entry('manifest.json', '{}', {
              header: { size: 2, compressedSize: 2, encrypted: true },
            }),
          ],
          TEST_LIMITS,
        ),
      'ENCRYPTED_ENTRY',
    );
  });

  it('enforces actual per-entry and cumulative bytes while reading', () => {
    const first = entry('manifest.json', '{}', {
      header: { size: 2, compressedSize: 2, encrypted: false },
      getData: () => Buffer.alloc(33),
    });
    const oversizedReader = createPackageZipReader([first], TEST_LIMITS);
    expectZipError(() => oversizedReader.readText(first), 'ENTRY_TOO_LARGE');

    const one = entry('a.json', 'a', {
      header: { size: 24, compressedSize: 24, encrypted: false },
      getData: () => Buffer.alloc(24, 'a'),
    });
    const two = entry('b.json', 'b', {
      header: { size: 24, compressedSize: 24, encrypted: false },
      getData: () => Buffer.alloc(25, 'b'),
    });
    const cumulativeReader = createPackageZipReader([one, two], TEST_LIMITS);
    expect(cumulativeReader.readText(one)).toHaveLength(24);
    expectZipError(
      () => cumulativeReader.readText(two),
      'ARCHIVE_TOO_LARGE',
    );
  });

  it('reads a small, safe package entry as UTF-8 text', () => {
    const manifest = entry('manifest.json', '{"name":"安全导入"}');
    const reader = createPackageZipReader([manifest], TEST_LIMITS);

    expect(reader.readText(manifest)).toBe('{"name":"安全导入"}');
  });

  it('reads entries produced by the installed adm-zip runtime', () => {
    const archive = new AdmZip();
    archive.addFile('manifest.json', Buffer.from('{"name":"真实 ZIP"}'));
    const parsed = new AdmZip(archive.toBuffer());
    const entries = parsed.getEntries();
    const reader = createPackageZipReader(entries);

    expect(reader.readText(entries[0]!)).toBe('{"name":"真实 ZIP"}');
  });
});
