import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { ApiClient } from './api-client.js';
import { startHeartbeat, stopHeartbeat, sendHeartbeat, setAgentStatus } from './heartbeat.js';
import { startPoller, stopPoller } from './build-poller.js';
import { executeBuild } from './build-executor.js';
import { startCommandPoller, stopCommandPoller } from './command-poller.js';
import { executeCommand } from './command-executor.js';

const MAX_CONNECT_RETRIES = 5;
const CONNECT_RETRY_DELAY_MS = 5000;

async function main() {
  logger.info('BIM Agent starting...');

  // 1. Load config
  const config = loadConfig();
  logger.info(`Server: ${config.serverUrl}`);

  // 2. Create API client
  const client = new ApiClient(config.serverUrl, config.apiKey);

  // 3. Initial heartbeat — verify connection
  let connected = false;
  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    logger.info(`Connecting to server (attempt ${attempt}/${MAX_CONNECT_RETRIES})...`);
    connected = await sendHeartbeat(client);
    if (connected) break;

    if (attempt < MAX_CONNECT_RETRIES) {
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY_MS));
    }
  }

  if (!connected) {
    logger.error(`Failed to connect after ${MAX_CONNECT_RETRIES} attempts. Exiting.`);
    process.exit(1);
  }

  logger.info('Connected to server');

  // 4. Start heartbeat
  startHeartbeat(client, config.heartbeatIntervalMs);

  // 5. Start build poller
  startPoller(client, config.pollIntervalMs, (build) => {
    executeBuild(client, build, config);
  });

  // 6. Start command poller
  startCommandPoller(client, config.pollIntervalMs, (command) => {
    executeCommand(client, command);
  });

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    stopPoller();
    stopCommandPoller();
    stopHeartbeat();

    setAgentStatus('offline');
    await sendHeartbeat(client).catch(() => {});

    logger.info('Agent stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('BIM Agent ready. Waiting for builds...');
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
