import { logger } from './logger.js';
import type {
  HeartbeatRequest,
  PendingBuildsResponse,
  ProgressReport,
  PendingCommandsResponse,
  CommandResult,
} from './types.js';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 15_000;

export class ApiClient {
  private serverUrl: string;
  private apiKey: string;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const url = `${this.serverUrl}${path}`;
        const options: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        };

        if (body !== undefined) {
          options.body = JSON.stringify(body);
        }

        const res = await fetch(url, options);

        if (res.status === 401) {
          logger.error('Authentication failed (401). Check API_KEY.');
          process.exit(1);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout (${TIMEOUT_MS}ms)`);
        }

        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
          logger.warn(
            `Request failed (attempt ${attempt}/${MAX_RETRIES}), retry in ${delay}ms: ${lastError.message}`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError!;
  }

  async sendHeartbeat(data: HeartbeatRequest): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/agent/heartbeat', data);
  }

  async getPendingBuilds(): Promise<PendingBuildsResponse> {
    return this.request('GET', '/api/agent/builds/pending');
  }

  async reportProgress(
    buildId: string,
    data: ProgressReport
  ): Promise<{ ok: boolean; cancelled?: boolean }> {
    return this.request('POST', `/api/agent/builds/${buildId}/progress`, data);
  }

  async getPendingCommands(): Promise<PendingCommandsResponse> {
    return this.request('GET', '/api/agent/commands/pending');
  }

  async ackCommand(commandId: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/api/agent/commands/${commandId}/ack`);
  }

  async reportCommandResult(commandId: string, data: CommandResult): Promise<{ ok: boolean }> {
    return this.request('POST', `/api/agent/commands/${commandId}/result`, data);
  }

  async reportVersionHistory(
    commandId: string,
    data: { filePath: string; versionHistory: unknown[] }[]
  ): Promise<{ ok: boolean }> {
    return this.request('POST', `/api/agent/commands/${commandId}/versions`, data);
  }
}
