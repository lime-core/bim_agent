import { logger } from './logger.js';
import type { ApiClient } from './api-client.js';
import type { Build } from './types.js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let isBusy = false;

export function setBusy(busy: boolean): void {
  isBusy = busy;
}

export function startPoller(
  client: ApiClient,
  intervalMs: number,
  onBuildReceived: (build: Build) => void
): void {
  intervalId = setInterval(() => poll(client, onBuildReceived), intervalMs);
  logger.info(`Build poller started (every ${intervalMs / 1000}s)`);
}

export function stopPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function poll(client: ApiClient, onBuildReceived: (build: Build) => void): Promise<void> {
  if (isBusy) {
    logger.debug('Poller: busy, skipping');
    return;
  }

  try {
    const response = await client.getPendingBuilds();

    if (response.builds.length > 0) {
      const build = response.builds[0];
      logger.info(`Received build ${build.id} (${build.totalSteps} steps)`);
      onBuildReceived(build);
    }
  } catch (err) {
    logger.warn(`Poll failed: ${err instanceof Error ? err.message : err}`);
  }
}
