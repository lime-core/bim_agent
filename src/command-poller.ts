import { logger } from './logger.js';
import type { ApiClient } from './api-client.js';
import type { AgentCommand } from './types.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startCommandPoller(
  client: ApiClient,
  intervalMs: number,
  onCommandReceived: (command: AgentCommand) => void
): void {
  intervalId = setInterval(() => poll(client, onCommandReceived), intervalMs);
  logger.info(`Command poller started (every ${intervalMs / 1000}s)`);
}

export function stopCommandPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function poll(
  client: ApiClient,
  onCommandReceived: (command: AgentCommand) => void
): Promise<void> {
  try {
    const response = await client.getPendingCommands();

    if (response.commands.length > 0) {
      const command = response.commands[0];
      logger.info(`Received command: ${command.commandType} (${command.id})`);
      onCommandReceived(command);
    }
  } catch (err) {
    logger.warn(`Command poll failed: ${err instanceof Error ? err.message : err}`);
  }
}
