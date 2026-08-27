import type { MediaUploadIntent } from './lite-api';

export interface MediaUploadResult {
  parts?: Array<{ partNumber: number; etag: string }>;
}

function putBlob(input: {
  url: string;
  body: Blob;
  headers: Record<string, string>;
  signal?: AbortSignal;
  onProgress: (loaded: number) => void;
}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('PUT', input.url);
    for (const [name, value] of Object.entries(input.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener('progress', (event) => {
      input.onProgress(event.loaded);
    });
    request.addEventListener('load', () => {
      input.signal?.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader('etag'));
      } else {
        reject(new Error(`媒体上传失败（HTTP ${request.status}）`));
      }
    });
    request.addEventListener('error', () => {
      input.signal?.removeEventListener('abort', abort);
      reject(new Error('媒体上传网络中断'));
    });
    request.addEventListener('abort', () => {
      input.signal?.removeEventListener('abort', abort);
      reject(new DOMException('媒体上传已取消', 'AbortError'));
    });
    if (input.signal?.aborted) {
      request.abort();
      return;
    }
    input.signal?.addEventListener('abort', abort, { once: true });
    request.send(input.body);
  });
}

export async function uploadMediaFile(input: {
  intent: MediaUploadIntent;
  file: File;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<MediaUploadResult> {
  let completedBytes = 0;
  const report = (partLoaded: number) => {
    const loaded = Math.min(input.file.size, completedBytes + partLoaded);
    input.onProgress?.(
      input.file.size > 0 ? Math.round((loaded / input.file.size) * 100) : 100,
    );
  };

  if (input.intent.uploadMode === 'single_put') {
    await putBlob({
      url: input.intent.upload.url,
      body: input.file,
      headers: input.intent.upload.requiredHeaders,
      signal: input.signal,
      onProgress: report,
    });
    input.onProgress?.(100);
    return {};
  }

  const completedParts: Array<{ partNumber: number; etag: string }> = [];
  for (const part of input.intent.multipart.parts) {
    const start = (part.partNumber - 1) * input.intent.multipart.partSizeBytes;
    const end = Math.min(start + input.intent.multipart.partSizeBytes, input.file.size);
    const body = input.file.slice(start, end);
    const etag = await putBlob({
      url: part.url,
      body,
      headers: part.requiredHeaders,
      signal: input.signal,
      onProgress: report,
    });
    if (!etag) throw new Error(`分片 ${part.partNumber} 未返回 ETag`);
    completedParts.push({ partNumber: part.partNumber, etag });
    completedBytes += body.size;
    report(0);
  }
  input.onProgress?.(100);
  return { parts: completedParts };
}
