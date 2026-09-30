import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function rootFile(path: string) {
  return readFileSync(resolve(process.cwd(), '..', path), 'utf8');
}

describe('multimodal local deployment contract', () => {
  it('ships MinIO, bucket initialization, and horizontally scalable real workers', () => {
    const compose = rootFile('docker-compose.yml');
    const workerDockerfile = rootFile('python/media_worker/Dockerfile');
    const workerProject = rootFile('python/media_worker/pyproject.toml');
    const serverDockerfile = rootFile('educlaw-server/Dockerfile');
    const webDockerfile = rootFile('educlaw-web/Dockerfile');

    expect(compose).toContain('educlaw-minio:');
    expect(compose).toContain('educlaw-minio-init:');
    expect(compose).toContain('educlaw-db-init:');
    expect(compose).toContain('node dist/educlaw-server/src/scripts/init-db.js');
    expect(compose).toMatch(
      /educlaw-db-init:[\s\S]*?MEDIA_UPLOAD_TOKEN_SECRET=\$\{MEDIA_UPLOAD_TOKEN_SECRET\}[\s\S]*?INTERNAL_WORKER_TOKENS=\$\{INTERNAL_WORKER_TOKENS\}/,
    );
    expect(compose).toMatch(
      /educlaw-server:[\s\S]*?educlaw-db-init:\s*\r?\n\s*condition: service_completed_successfully/,
    );
    expect(compose).toContain("fetch('http://127.0.0.1:3000/readyz')");
    expect(
      compose.match(/educlaw-server:\s*\r?\n\s*condition: service_healthy/g),
    ).toHaveLength(3);
    expect(compose).toContain('mc mb --ignore-existing');
    expect(compose).toContain('MINIO_API_CORS_ALLOW_ORIGIN=${APP_ORIGIN:-http://eduskill.localhost}');
    expect(compose).not.toContain('mc cors set');
    expect(compose).toContain('educlaw-media-quality-worker:');
    expect(compose).toContain('educlaw-media-distillation-worker:');
    expect(compose.match(/replicas:\s*2/g)).toHaveLength(2);
    expect(compose).toContain('MEDIA_WORKER_EXECUTOR_MODE=media_quality_check');
    expect(compose).toContain('MEDIA_WORKER_EXECUTOR_MODE=distillation');
    expect(compose).not.toMatch(/MEDIA_WORKER[\s\S]{0,500}DATABASE_URL/);
    expect(compose).not.toMatch(/mc\s+ilm\s+rule\s+add|expire-days|noncurrent-expire/);
    expect(workerDockerfile).toContain('ffmpeg');
    expect(workerDockerfile).toContain('asr-local');
    expect(workerProject).toContain('flatbuffers==25.9.23');
    expect(serverDockerfile).toContain('FROM node:22-slim');
    expect(serverDockerfile).not.toContain('FROM node:20-slim');
    expect(webDockerfile).toContain('FROM node:22-slim');
  });

  it('documents every server/worker storage and recovery setting without real secrets', () => {
    const env = rootFile('.env.example');

    for (const key of [
      'INTERNAL_WORKER_TOKENS',
      'MEDIA_WORKER_BASE_URL',
      'MEDIA_WORKER_SERVICE_TOKEN',
      'MEDIA_WORKER_MAX_DURATION_MS',
      'MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS',
      'MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS',
      'MEDIA_WORKER_ASR_MODEL',
      'MINIO_ROOT_USER',
      'MINIO_ROOT_PASSWORD',
    ]) expect(env).toContain(`${key}=`);
    expect(env).not.toMatch(/(?:sk-|Bearer\s+)[A-Za-z0-9_-]{16,}/);
  });

  it('serves the SPA with real API proxies, compression, and immutable asset caching', () => {
    const dockerfile = rootFile('educlaw-web/Dockerfile');
    const nginx = rootFile('educlaw-web/nginx/default.conf.template');

    expect(dockerfile).toContain('/etc/nginx/templates/default.conf.template');
    expect(dockerfile).toContain('NGINX_ENVSUBST_FILTER');
    expect(nginx).toContain('proxy_pass ${API_UPSTREAM}');
    expect(nginx).toContain('proxy_pass ${AUTH_UPSTREAM}');
    expect(nginx).toContain('(?:livez|readyz|healthz)');
    expect(nginx).toContain('gzip on;');
    expect(nginx).toContain('max-age=31536000, immutable');
    expect(nginx).toContain('Cache-Control "no-cache"');
    expect(nginx).toContain('proxy_buffering off;');
  });
});
