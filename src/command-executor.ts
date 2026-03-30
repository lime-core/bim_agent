import { logger } from './logger.js';
import { scanFolder } from './folder-scanner.js';
import type { ApiClient } from './api-client.js';
import type { AgentCommand, CommandResult } from './types.js';

export async function executeCommand(client: ApiClient, command: AgentCommand): Promise<void> {
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
        result = await executeScanDataSource(command);
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

  // Report result
  try {
    await client.reportCommandResult(command.id, result);
    logger.info(`Command ${command.id} ${result.status}`);
  } catch (err) {
    logger.error(`Failed to report command result: ${err instanceof Error ? err.message : err}`);
  }
}

async function executeScanDataSource(command: AgentCommand): Promise<CommandResult> {
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
    // Phase 2: Revit Server REST API scanning
    return {
      status: 'failed',
      errorMessage: 'Revit Server scanning is not yet implemented',
    };
  }

  return { status: 'failed', errorMessage: `Unknown data source type: ${dataSource.type}` };
}
