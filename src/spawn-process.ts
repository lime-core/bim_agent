import { spawn } from 'node:child_process';
import { logger } from './logger.js';

// CP1251 table: bytes 128-255 → Unicode codepoints
const CP1251 = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039,
  0x040a, 0x040c, 0x040b, 0x040f, 0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x0000, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f, 0x00a0, 0x040e, 0x045e, 0x0408,
  0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb,
  0x0458, 0x0405, 0x0455, 0x0457, 0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
  0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423,
  0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f,
  0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b,
  0x043c, 0x043d, 0x043e, 0x043f, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
  0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f,
];

// CP866 table: bytes 128-255 → Unicode codepoints
const CP866 = [
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041a, 0x041b,
  0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
  0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f, 0x0430, 0x0431, 0x0432, 0x0433,
  0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557,
  0x255d, 0x255c, 0x255b, 0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, 0x2568, 0x2564, 0x2565, 0x2559,
  0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044a, 0x044b,
  0x044c, 0x044d, 0x044e, 0x044f, 0x0401, 0x0451, 0x0404, 0x0454, 0x0407, 0x0457, 0x040e, 0x045e,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x2116, 0x00a4, 0x25a0, 0x00a0,
];

function decodeSingleByte(buf: Buffer, table: number[]): string {
  let result = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    result += b < 128 ? String.fromCharCode(b) : String.fromCharCode(table[b - 128]);
  }
  return result;
}

function decodeOutput(chunk: Buffer, encoding?: string): string {
  if (!encoding || encoding === 'utf-8' || encoding === 'utf8') return chunk.toString('utf-8');
  if (encoding === 'cp1251' || encoding === 'windows-1251') return decodeSingleByte(chunk, CP1251);
  if (encoding === 'cp866' || encoding === 'ibm866') return decodeSingleByte(chunk, CP866);
  return chunk.toString('utf-8');
}

export interface SpawnOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Encoding for stdout/stderr. Use 'cp1251' for Autodesk tools on Russian Windows. Default: 'utf-8' */
  encoding?: string;
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
      const text = decodeOutput(chunk, options?.encoding);
      stdout += text;
      for (const line of text.split('\n').filter(Boolean)) {
        logger.info(`[stdout] ${line}`);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = decodeOutput(chunk, options?.encoding);
      stderr += text;
      for (const line of text.split('\n').filter(Boolean)) {
        logger.warn(`[stderr] ${line}`);
      }
    });

    // Timeout kill
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        killed = true;
        logger.warn(`Process timed out after ${options.timeoutMs}ms, killing...`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);
    }

    // AbortSignal kill (cancellation from server)
    if (options?.signal) {
      const onAbort = () => {
        if (!killed) {
          killed = true;
          logger.info('Process cancelled via AbortSignal, killing...');
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
        }
      };
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed && options?.signal?.aborted) {
        reject(new Error('Process cancelled'));
      } else if (killed) {
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
