import { logger } from './logger.js';
import type { ApiClient } from './api-client.js';
import type { AgentStatus } from './types.js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentStatus: AgentStatus = 'online';

export function setAgentStatus(status: AgentStatus): void {
  currentStatus = status;
}

export function startHeartbeat(client: ApiClient, intervalMs: number): void {
  // Send immediately on start
  sendHeartbeat(client);

  intervalId = setInterval(() => sendHeartbeat(client), intervalMs);
  logger.info(`Heartbeat started (every ${intervalMs / 1000}s)`);
}

export function stopHeartbeat(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export async function sendHeartbeat(client: ApiClient): Promise<boolean> {
  try {
    await client.sendHeartbeat({ status: currentStatus });
    logger.debug(`Heartbeat sent: ${currentStatus}`);
    return true;
  } catch (err) {
    logger.warn(`Heartbeat failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
