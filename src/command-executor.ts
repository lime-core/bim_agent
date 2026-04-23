import { logger } from './logger.js';
import { scanFolder, testFolderAccess } from './folder-scanner.js';
import { scanRevitServer, testRevitServerConnection } from './revit-server-scanner.js';
import type { ApiClient } from './api-client.js';
import type { AgentConfig } from './config.js';
import type { AgentCommand, CommandResult, ScanFileEntry, VersionHistoryEntry } from './types.js';

const VERSIONS_CHUNK_SIZE = 10; // models per chunk

export async function executeCommand(
  client: ApiClient,
  command: AgentCommand,
  agentConfig: AgentConfig
): Promise<void> {
  logger.info(`Executing command ${command.commandType} (${command.id})`);

  // Acknowledge command
  try {
    await client.ackCommand(command.id);
  } catch (err) {
    logger.error(
      `Failed to ack command ${command.id}: ${err instanceof Error ? err.message : err}`
    );
    return;
  }

  let result: CommandResult;

  try {
    switch (command.commandType) {
      case 'scan_data_source':
        result = await executeScanDataSource(command, agentConfig);
        break;
      case 'test_connection':
        result = await executeTestConnection(command, agentConfig);
        break;
      default:
        result = {
          status: 'failed',
          errorMessage: `Unknown command type: ${command.commandType}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Command ${command.id} error: ${message}`);
    result = { status: 'failed', errorMessage: message };
  }

  // Separate version history from result to keep payload small
  let versionHistories: { filePath: string; versionHistory: VersionHistoryEntry[] }[] = [];

  if (result.status === 'completed' && result.result?.files) {
    const files = result.result.files as ScanFileEntry[];
    versionHistories = files
      .filter((f) => f.versionHistory && f.versionHistory.length > 0)
      .map((f) => ({ filePath: f.filePath, versionHistory: f.versionHistory! }));

    // Strip versionHistory from main payload
    result.result.files = files.map(({ versionHistory, ...rest }) => rest);
  }

  // Report main result (lightweight)
  try {
    await client.reportCommandResult(command.id, result);
    logger.info(`Command ${command.id} ${result.status}`);
  } catch (err) {
    logger.error(`Failed to report command result: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Send version histories in chunks
  if (versionHistories.length > 0) {
    for (let i = 0; i < versionHistories.length; i += VERSIONS_CHUNK_SIZE) {
      const chunk = versionHistories.slice(i, i + VERSIONS_CHUNK_SIZE);
      try {
        await client.reportVersionHistory(command.id, chunk);
        logger.info(
          `Sent version history chunk ${Math.floor(i / VERSIONS_CHUNK_SIZE) + 1}/${Math.ceil(versionHistories.length / VERSIONS_CHUNK_SIZE)} (${chunk.length} models)`
        );
      } catch (err) {
        logger.error(
          `Failed to send version history chunk: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }
}

async function executeScanDataSource(
  command: AgentCommand,
  agentConfig: AgentConfig
): Promise<CommandResult> {
  const { dataSource } = command;

  if (dataSource.type === 'folder') {
    if (!dataSource.folderPath) {
      return { status: 'failed', errorMessage: 'Data source has no folder path' };
    }

    logger.info(`Scanning folder: ${dataSource.folderPath}`);
    const files = await scanFolder(dataSource.folderPath);
    return { status: 'completed', result: { files } };
  }

  if (dataSource.type === 'revit_server') {
    if (!dataSource.serverAddress) {
      return { status: 'failed', errorMessage: 'Data source has no server address' };
    }

    logger.info(
      `Scanning Revit Server: ${dataSource.serverAddress}/${dataSource.serverPath || ''}` +
        (dataSource.useLocalCredentials ? ' (using local agent credentials)' : '')
    );
    const files = await scanRevitServer(dataSource, agentConfig);
    return { status: 'completed', result: { files } };
  }

  return { status: 'failed', errorMessage: `Unknown data source type: ${dataSource.type}` };
}

async function executeTestConnection(
  command: AgentCommand,
  agentConfig: AgentConfig
): Promise<CommandResult> {
  const { dataSource } = command;

  if (dataSource.type === 'folder') {
    if (!dataSource.folderPath) {
      return { status: 'failed', errorMessage: 'Путь к папке не указан' };
    }

    logger.info(`Testing folder access: ${dataSource.folderPath}`);
    const message = await testFolderAccess(dataSource.folderPath);
    return { status: 'completed', result: { message } };
  }

  if (dataSource.type === 'revit_server') {
    if (!dataSource.serverAddress) {
      return { status: 'failed', errorMessage: 'Адрес сервера не указан' };
    }

    logger.info(
      `Testing Revit Server connection: ${dataSource.serverAddress}` +
        (dataSource.useLocalCredentials ? ' (using local agent credentials)' : '')
    );
    const message = await testRevitServerConnection(dataSource, agentConfig);
    return { status: 'completed', result: { message } };
  }

  return { status: 'failed', errorMessage: `Unknown data source type: ${dataSource.type}` };
}
