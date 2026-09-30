import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const workerDirectory = join(repositoryRoot, 'python', 'media_worker');

const configuredPython = process.env.MEDIA_WORKER_PYTHON?.trim();
const localVirtualEnvironmentPython =
  process.platform === 'win32'
    ? join(workerDirectory, '.venv', 'Scripts', 'python.exe')
    : join(workerDirectory, '.venv', 'bin', 'python');

const candidates = [
  configuredPython,
  existsSync(localVirtualEnvironmentPython)
    ? localVirtualEnvironmentPython
    : undefined,
  process.platform === 'win32' ? 'python' : 'python3',
  process.platform === 'win32' ? 'py' : 'python',
].filter(Boolean);

function available(command) {
  const args = command === 'py' ? ['-3', '--version'] : ['--version'];
  const result = spawnSync(command, args, {
    cwd: workerDirectory,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0;
}

const python = candidates.find(available);
if (!python) {
  console.error(
    '找不到可用的 Python 3。请创建 python/media_worker/.venv，或设置 MEDIA_WORKER_PYTHON。',
  );
  process.exit(1);
}

const pythonArgs = python === 'py' ? ['-3'] : [];
const result = spawnSync(python, [...pythonArgs, '-m', 'pytest', 'tests'], {
  cwd: workerDirectory,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`无法启动 Python Worker 测试：${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
