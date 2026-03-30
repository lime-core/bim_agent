import { spawn } from 'node:child_process';
import { logger } from './logger.js';

export interface SpawnOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function spawnProcess(
  exe: string,
  args: string[],
  options?: SpawnOptions
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    logger.debug(`Spawn: ${exe} ${args.join(' ')}`);

    const child = spawn(exe, args, {
      cwd: options?.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      for (const line of text.split('\n').filter(Boolean)) {
        logger.info(`[stdout] ${line}`);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      for (const line of text.split('\n').filter(Boolean)) {
        logger.warn(`[stderr] ${line}`);
      }
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        reject(new Error(`Process timed out after ${options?.timeoutMs}ms`));
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
