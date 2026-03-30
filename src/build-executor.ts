import { logger } from './logger.js';
import { runStep } from './script-runner.js';
import { setAgentStatus } from './heartbeat.js';
import { setBusy } from './build-poller.js';
import { BuildContext } from './build-context.js';
import type { ApiClient } from './api-client.js';
import type { AgentConfig } from './config.js';
import type { Build, BuildStep } from './types.js';

export async function executeBuild(
  client: ApiClient,
  build: Build,
  config: AgentConfig
): Promise<void> {
  logger.info(`=== Starting build ${build.id} (${build.steps.length} steps) ===`);

  setBusy(true);
  setAgentStatus('busy');

  try {
    // Initialize build context (working directories)
    const context = new BuildContext(config.workDir, build.id);
    await context.initialize();
    logger.info(`Work dir: ${context.baseDir}`);

    // Report downloading status
    await client.reportProgress(build.id, { buildStatus: 'downloading' });

    // Sort steps by creation order (they come pre-sorted from server)
    const steps = build.steps;

    // Determine build phase from step types
    let currentPhase = '';

    for (const step of steps) {
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
        return;
      }

      // Execute step
      const result = await runStep(step, context, config, steps);

      if (result.success) {
        const completedResponse = await client.reportProgress(build.id, {
          stepId: step.id,
          status: 'completed',
          progress: 100,
          logOutput: result.output,
        });
        logger.info(`Step ${step.stepType} completed: ${step.id}`);

        if (completedResponse.cancelled) {
          logger.info(`Build ${build.id} CANCELLED by user`);
          return;
        }
      } else {
        await client.reportProgress(build.id, {
          stepId: step.id,
          status: 'failed',
          errorMessage: result.errorMessage,
          logOutput: result.output,
        });

        // Fail entire build
        await client.reportProgress(build.id, {
          buildStatus: 'failed',
          buildErrorMessage: `Step ${step.stepType} failed: ${result.errorMessage}`,
        });

        logger.error(`Build ${build.id} FAILED at step ${step.id}: ${result.errorMessage}`);
        return;
      }
    }

    // All steps completed
    await client.reportProgress(build.id, { buildStatus: 'completed' });
    logger.info(`=== Build ${build.id} COMPLETED ===`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
