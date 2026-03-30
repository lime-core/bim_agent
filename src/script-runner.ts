import { copyFile, writeFile, access, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { BuildStep, StepResult } from './types.js';
import type { BuildContext } from './build-context.js';
import type { AgentConfig } from './config.js';
import { getNavisworksPath } from './config.js';
import { logger } from './logger.js';
import { spawnProcess } from './spawn-process.js';

export async function runStep(
  step: BuildStep,
  context: BuildContext,
  config: AgentConfig,
  allSteps: BuildStep[]
): Promise<StepResult> {
  switch (step.stepType) {
    case 'download':
      return handleDownload(step, context);
    case 'convert_rvt_nwd':
      return handleConvert(step, context, config);
    case 'assemble_section':
      return handleAssembleSection(step, context, config, allSteps);
    case 'assemble_final':
      return handleAssembleFinal(step, context, config, allSteps);
    default:
      return { success: false, output: '', errorMessage: `Unknown step type: ${step.stepType}` };
  }
}

async function handleDownload(step: BuildStep, context: BuildContext): Promise<StepResult> {
  if (!step.model) {
    return { success: false, output: '', errorMessage: 'Download step has no model' };
  }

  const { model } = step;
  const dataSource = model.dataSource;

  if (!dataSource) {
    return { success: false, output: '', errorMessage: 'Model has no data source info' };
  }

  if (dataSource.type === 'folder') {
    if (!dataSource.folderPath) {
      return { success: false, output: '', errorMessage: 'Data source has no folder path' };
    }

    const sourcePath = join(dataSource.folderPath, model.filePath);
    const destPath = join(context.downloadsDir, model.fileName);

    logger.info(`Copying ${sourcePath} → ${destPath}`);

    try {
      await access(sourcePath);
    } catch {
      return { success: false, output: '', errorMessage: `Source file not found: ${sourcePath}` };
    }

    await copyFile(sourcePath, destPath);
    context.setDownloadedPath(model.id, destPath);

    return { success: true, output: `Downloaded ${model.fileName}`, outputPath: destPath };
  }

  if (dataSource.type === 'revit_server') {
    return {
      success: false,
      output: '',
      errorMessage: 'Revit Server download not yet implemented',
    };
  }

  return {
    success: false,
    output: '',
    errorMessage: `Unknown data source type: ${dataSource.type}`,
  };
}

async function handleConvert(
  step: BuildStep,
  context: BuildContext,
  config: AgentConfig
): Promise<StepResult> {
  if (!step.model) {
    return { success: false, output: '', errorMessage: 'Convert step has no model' };
  }

  const rvtPath = context.getDownloadedPath(step.model.id);
  if (!rvtPath) {
    return {
      success: false,
      output: '',
      errorMessage: `No downloaded file for model ${step.model.fileName}`,
    };
  }

  const revitVersion = step.model.dataSource?.revitVersion;
  if (!revitVersion) {
    return {
      success: false,
      output: '',
      errorMessage: 'Model has no Revit version — set it on the data source',
    };
  }

  const navisworksExe = getNavisworksPath(config, revitVersion);
  const nwdFileName = basename(step.model.fileName, '.rvt') + '.nwd';
  const nwdPath = join(context.convertedDir, nwdFileName);

  // Create temp input file (UTF-8 no BOM — Node.js default)
  const inputTxtPath = join(context.convertedDir, `_input_${step.id}.txt`);
  await writeFile(inputTxtPath, rvtPath, 'utf-8');

  logger.info(`Converting ${step.model.fileName} → ${nwdFileName} (Navisworks ${revitVersion})`);
  logger.info(
    `Command: "${navisworksExe}" /i "${inputTxtPath}" /of "${nwdPath}" /over /lang ${config.navisworksLang}`
  );
  logger.info(`Input file contents: ${rvtPath}`);

  try {
    const result = await spawnProcess(
      navisworksExe,
      ['/i', inputTxtPath, '/of', nwdPath, '/over', '/lang', config.navisworksLang],
      { timeoutMs: config.processTimeoutMs }
    );

    logger.info(`FileToolsTaskRunner exited with code ${result.exitCode}`);

    // Cleanup temp file
    await unlink(inputTxtPath).catch(() => {});

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        errorMessage: `FileToolsTaskRunner exited with code ${result.exitCode}: ${result.stderr}`,
      };
    }

    // Verify output exists
    try {
      await access(nwdPath);
    } catch {
      return {
        success: false,
        output: result.stdout,
        errorMessage: `Conversion completed but output file not found: ${nwdPath}`,
      };
    }

    context.setConvertedPath(step.model.id, nwdPath);
    return { success: true, output: `Converted ${nwdFileName}`, outputPath: nwdPath };
  } catch (err) {
    await unlink(inputTxtPath).catch(() => {});
    throw err;
  }
}

async function handleAssembleSection(
  step: BuildStep,
  context: BuildContext,
  config: AgentConfig,
  allSteps: BuildStep[]
): Promise<StepResult> {
  if (!step.sectionId || !step.section) {
    return { success: false, output: '', errorMessage: 'Assemble section step has no section' };
  }

  // Find all converted NWDs for this section
  const sectionNwds: string[] = [];
  for (const s of allSteps) {
    if (s.stepType === 'convert_rvt_nwd' && s.model?.sectionId === step.sectionId) {
      const nwdPath = context.getConvertedPath(s.model.id);
      if (nwdPath) sectionNwds.push(nwdPath);
    }
  }

  if (sectionNwds.length === 0) {
    return { success: true, output: `No models in section ${step.section.name}, skipping` };
  }

  // Determine Revit version from first model in section
  const revitVersion = resolveRevitVersion(allSteps, step.sectionId);
  if (!revitVersion) {
    return {
      success: false,
      output: '',
      errorMessage: 'Cannot determine Revit version for section assembly',
    };
  }

  const navisworksExe = getNavisworksPath(config, revitVersion);
  const sectionName = step.section.name;
  const sectionNwdPath = join(context.outputDir, `${sectionName}.nwd`);

  // Create input file with list of NWDs
  const inputTxtPath = join(context.outputDir, `_input_section_${step.id}.txt`);
  await writeFile(inputTxtPath, sectionNwds.join('\n'), 'utf-8');

  logger.info(
    `Assembling section "${sectionName}" (${sectionNwds.length} models, Navisworks ${revitVersion})`
  );

  try {
    const result = await spawnProcess(
      navisworksExe,
      ['/i', inputTxtPath, '/of', sectionNwdPath, '/over', '/lang', config.navisworksLang],
      { timeoutMs: config.processTimeoutMs }
    );

    await unlink(inputTxtPath).catch(() => {});

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        errorMessage: `Section assembly failed (code ${result.exitCode}): ${result.stderr}`,
      };
    }

    context.setSectionPath(step.sectionId, sectionNwdPath);
    return {
      success: true,
      output: `Assembled section "${sectionName}"`,
      outputPath: sectionNwdPath,
    };
  } catch (err) {
    await unlink(inputTxtPath).catch(() => {});
    throw err;
  }
}

async function handleAssembleFinal(
  step: BuildStep,
  context: BuildContext,
  config: AgentConfig,
  allSteps: BuildStep[]
): Promise<StepResult> {
  // Collect all section NWDs
  const finalNwds: string[] = [...context.getAllSectionPaths()];

  // Add unassigned model NWDs (models with no section)
  for (const s of allSteps) {
    if (s.stepType === 'convert_rvt_nwd' && !s.model?.sectionId) {
      const nwdPath = context.getConvertedPath(s.model!.id);
      if (nwdPath) finalNwds.push(nwdPath);
    }
  }

  if (finalNwds.length === 0) {
    return { success: true, output: 'No NWDs to assemble into final model' };
  }

  // Determine Revit version from any model in the build
  const revitVersion = resolveRevitVersion(allSteps);
  if (!revitVersion) {
    return {
      success: false,
      output: '',
      errorMessage: 'Cannot determine Revit version for final assembly',
    };
  }

  const navisworksExe = getNavisworksPath(config, revitVersion);
  const finalNwdPath = join(context.outputDir, 'federated.nwd');

  const inputTxtPath = join(context.outputDir, `_input_final_${step.id}.txt`);
  await writeFile(inputTxtPath, finalNwds.join('\n'), 'utf-8');

  logger.info(`Assembling final model (${finalNwds.length} inputs, Navisworks ${revitVersion})`);

  try {
    const result = await spawnProcess(
      navisworksExe,
      ['/i', inputTxtPath, '/of', finalNwdPath, '/over', '/lang', config.navisworksLang],
      { timeoutMs: config.processTimeoutMs }
    );

    await unlink(inputTxtPath).catch(() => {});

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        errorMessage: `Final assembly failed (code ${result.exitCode}): ${result.stderr}`,
      };
    }

    return { success: true, output: 'Assembled final federated model', outputPath: finalNwdPath };
  } catch (err) {
    await unlink(inputTxtPath).catch(() => {});
    throw err;
  }
}

/**
 * Resolve Revit version from build steps.
 * Optionally filter by sectionId. Returns the first version found.
 */
function resolveRevitVersion(allSteps: BuildStep[], sectionId?: string | null): string | null {
  for (const s of allSteps) {
    if (s.stepType !== 'convert_rvt_nwd' || !s.model?.dataSource?.revitVersion) continue;
    if (sectionId && s.model.sectionId !== sectionId) continue;
    return s.model.dataSource.revitVersion;
  }
  return null;
}
