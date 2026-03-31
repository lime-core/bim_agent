import { logger } from './logger.js';
import { runStep } from './script-runner.js';
import { setAgentStatus } from './heartbeat.js';
import { setBusy } from './build-poller.js';
import { BuildContext } from './build-context.js';
import type { ApiClient } from './api-client.js';
import type { AgentConfig } from './config.js';
import type { Build, BuildStep } from './types.js';

// Cancellation polling interval: check server every 10 seconds during long steps
const CANCEL_POLL_INTERVAL_MS = 10_000;

export async function executeBuild(
  client: ApiClient,
  build: Build,
  config: AgentConfig
): Promise<void> {
  logger.info(`=== Starting build ${build.id} (${build.steps.length} steps) ===`);

  setBusy(true);
  setAgentStatus('busy');

  // Create AbortController for killing child processes on cancellation
  const abortController = new AbortController();
  let cancelPollTimer: ReturnType<typeof setInterval> | null = null;

  // Background polling: check if build was cancelled on the server
  cancelPollTimer = setInterval(async () => {
    try {
      const response = await client.reportProgress(build.id, {});
      if (response.cancelled) {
        logger.info(`Build ${build.id} cancellation detected via polling`);
        abortController.abort();
      }
    } catch {
      // Ignore polling errors — don't break the build
    }
  }, CANCEL_POLL_INTERVAL_MS);

  try {
    const context = new BuildContext(
      config.workDir,
      build.id,
      build.configName,
      build.assemblySettings
    );
    await context.initialize();
    logger.info(`Work dir: ${context.rootDir}`);

    await client.reportProgress(build.id, { buildStatus: 'downloading' });

    const steps = build.steps;
    let currentPhase = '';
    const allInvalidatedPaths: string[] = [];

    for (const step of steps) {
      // Check if already cancelled
      if (abortController.signal.aborted) {
        logger.info(`Build ${build.id} CANCELLED by user (before step ${step.stepType})`);
        await client.reportProgress(build.id, { buildStatus: 'cancelled' });
        return;
      }

      const phase = getPhase(step);
      if (phase !== currentPhase) {
        currentPhase = phase;
        await client.reportProgress(build.id, { buildStatus: phase as Build['status'] });
        logger.info(`--- Phase: ${phase} ---`);
      }

      // Report step running and check for cancellation
      const runningResponse = await client.reportProgress(build.id, {
        stepId: step.id,
        status: 'running',
      });

      if (runningResponse.cancelled) {
        logger.info(`Build ${build.id} CANCELLED by user`);
        abortController.abort();
        return;
      }

      // Execute step (with build context and abort signal)
      const result = await runStep(step, context, config, steps, build, abortController.signal);

      if (abortController.signal.aborted) {
        logger.info(`Build ${build.id} CANCELLED during step ${step.stepType}`);
        await client.reportProgress(build.id, {
          stepId: step.id,
          status: 'failed',
          errorMessage: 'Отменено пользователем',
        });
        await client.reportProgress(build.id, { buildStatus: 'cancelled' });
        return;
      }

      if (result.success) {
        // Accumulate invalidated cached paths across all steps
        if (result.invalidatedPaths && result.invalidatedPaths.length > 0) {
          allInvalidatedPaths.push(...result.invalidatedPaths);
        }

        const completedResponse = await client.reportProgress(build.id, {
          stepId: step.id,
          status: 'completed',
          progress: 100,
          logOutput: result.output,
          // Для convert шагов: сохранить путь к NWD на сервере (lastBuiltNwdPath)
          ...(step.stepType === 'convert_rvt_nwd' && step.model && result.outputPath
            ? { modelId: step.model.id, modelNwdPath: result.outputPath }
            : {}),
        });
        logger.info(`Step ${step.stepType} completed: ${step.id}`);

        if (completedResponse.cancelled) {
          logger.info(`Build ${build.id} CANCELLED by user`);
          abortController.abort();
          return;
        }
      } else {
        await client.reportProgress(build.id, {
          stepId: step.id,
          status: 'failed',
          errorMessage: result.errorMessage,
          logOutput: result.output,
        });

        await client.reportProgress(build.id, {
          buildStatus: 'failed',
          buildErrorMessage: `Step ${step.stepType} failed: ${result.errorMessage}`,
        });

        logger.error(`Build ${build.id} FAILED at step ${step.id}: ${result.errorMessage}`);
        return;
      }
    }

    await client.reportProgress(build.id, {
      buildStatus: 'completed',
      ...(allInvalidatedPaths.length > 0 ? { invalidatedNwdPaths: allInvalidatedPaths } : {}),
    });
    if (allInvalidatedPaths.length > 0) {
      logger.warn(
        `Build completed with ${allInvalidatedPaths.length} invalidated cached NWD(s) — ` +
          `affected models marked for rebuild on next trigger`
      );
    }
    logger.info(`=== Build ${build.id} COMPLETED ===`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (abortController.signal.aborted || message === 'Process cancelled') {
      logger.info(`Build ${build.id} CANCELLED (process killed)`);
      try {
        await client.reportProgress(build.id, { buildStatus: 'cancelled' });
      } catch {
        /* ignore */
      }
      return;
    }

    logger.error(`Build ${build.id} ERROR: ${message}`);
    try {
      await client.reportProgress(build.id, {
        buildStatus: 'failed',
        buildErrorMessage: message,
      });
    } catch {
      logger.error('Failed to report build error to server');
    }
  } finally {
    if (cancelPollTimer) clearInterval(cancelPollTimer);
    setBusy(false);
    setAgentStatus('online');
  }
}

function getPhase(step: BuildStep): string {
  switch (step.stepType) {
    case 'download':
      return 'downloading';
    case 'convert_rvt_nwd':
      return 'converting';
    case 'assemble_section':
      return 'assembling_sections';
    case 'assemble_final':
      return 'assembling_final';
    default:
      return 'downloading';
  }
}
