import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadMediaFile } from './media-upload';

class FakeTarget {
  listeners = new Map<string, Array<(event: ProgressEvent) => void>>();
  addEventListener(name: string, listener: (event: ProgressEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  emit(name: string, event = { loaded: 0 } as ProgressEvent) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class FakeXhr extends FakeTarget {
  static instances: FakeXhr[] = [];
  upload = new FakeTarget();
  status = 200;
  headers: Record<string, string> = {};
  body: Blob | null = null;
  constructor() {
    super();
    FakeXhr.instances.push(this);
  }
  open = vi.fn();
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return name.toLowerCase() === 'etag' ? `etag-${FakeXhr.instances.length}` : null;
  }
  send(body: Blob) {
    this.body = body;
    this.upload.emit('progress', { loaded: body.size } as ProgressEvent);
    queueMicrotask(() => this.emit('load'));
  }
  abort() {
    this.emit('abort');
  }
}

describe('media upload transport', () => {
  afterEach(() => {
    FakeXhr.instances = [];
    vi.unstubAllGlobals();
  });

  it('uploads multipart blobs in bounded slices and returns ordered ETags', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: number[] = [];
    const result = await uploadMediaFile({
      file: new File(['abcdefgh'], 'lesson.mp4', { type: 'video/mp4' }),
      intent: {
        sessionId: '1',
        revisionNo: 1,
        mediaStage: 'uploading',
        uploadMode: 'multipart',
        expiresAt: '2026-08-22T00:05:00.000Z',
        uploadToken: 'opaque',
        replayed: false,
        multipart: {
          partSizeBytes: 4,
          partCount: 2,
          parts: [
            { partNumber: 1, url: 'https://one', expiresAt: '', requiredHeaders: {} },
            { partNumber: 2, url: 'https://two', expiresAt: '', requiredHeaders: {} },
          ],
        },
      },
      onProgress: (value) => progress.push(value),
    });

    expect(FakeXhr.instances.map((request) => request.body?.size)).toEqual([4, 4]);
    expect(result.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
    ]);
    expect(progress.at(-1)).toBe(100);
  });
});
