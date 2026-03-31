import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { AssemblySettings } from './types';

/**
 * Sanitize a string for use as a filesystem directory/file name.
 * Replaces forbidden characters with '_', trims, collapses runs of '_'.
 */
export function sanitizePath(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

/**
 * Persistent file structure for a project's assembly output.
 *
 * {outputPath}/
 * ├── Кэш/{sourceName}/model.rvt
 * ├── Сконвертированные/{sectionName}/
 * │   ├── model.nwd
 * │   └── {sectionName}.nwd
 * ├── Сборки/{configName}/{configName}.nwd
 * └── Архив/
 *     ├── RVT/model_YYYY_MM_DD.rvt
 *     └── NWD/config_YYYY_MM_DD.nwd
 */
export class BuildContext {
  readonly buildId: string;
  readonly rootDir: string;
  readonly cacheDir: string;
  readonly convertedDir: string;
  readonly buildsDir: string;
  readonly archiveDir: string;
  readonly archiveRvtDir: string;
  readonly archiveNwdDir: string;
  readonly configName: string | null;
  readonly settings: AssemblySettings;

  // Legacy fallback dirs (used when no outputPath configured)
  private legacyBaseDir: string;
  private legacyDownloadsDir: string;
  private legacyConvertedDir: string;
  private legacyOutputDir: string;

  private downloadedFiles = new Map<string, string>();
  private convertedFiles = new Map<string, string>();
  private sectionFiles = new Map<string, string>();

  constructor(
    workDir: string,
    buildId: string,
    configName: string | null,
    settings: AssemblySettings | null
  ) {
    this.buildId = buildId;
    this.configName = configName;
    this.settings = settings || { outputPath: null, archiveRvtVersions: 3, archiveNwdVersions: 10 };

    if (this.settings.outputPath) {
      // Persistent structure
      this.rootDir = resolve(this.settings.outputPath);
      this.cacheDir = join(this.rootDir, 'Кэш');
      this.convertedDir = join(this.rootDir, 'Сконвертированные');
      this.buildsDir = join(this.rootDir, 'Сборки');
      this.archiveDir = join(this.rootDir, 'Архив');
      this.archiveRvtDir = join(this.archiveDir, 'RVT');
      this.archiveNwdDir = join(this.archiveDir, 'NWD');
    } else {
      // Legacy per-build structure (fallback)
      this.rootDir = resolve(workDir, 'builds', buildId);
      this.cacheDir = join(this.rootDir, 'downloads');
      this.convertedDir = join(this.rootDir, 'converted');
      this.buildsDir = join(this.rootDir, 'output');
      this.archiveDir = join(this.rootDir, 'archive');
      this.archiveRvtDir = join(this.archiveDir, 'RVT');
      this.archiveNwdDir = join(this.archiveDir, 'NWD');
    }

    // Legacy dirs for backward compat
    this.legacyBaseDir = resolve(workDir, 'builds', buildId);
    this.legacyDownloadsDir = join(this.legacyBaseDir, 'downloads');
    this.legacyConvertedDir = join(this.legacyBaseDir, 'converted');
    this.legacyOutputDir = join(this.legacyBaseDir, 'output');
  }

  /** Get cache directory for a data source */
  getSourceCacheDir(sourceName: string): string {
    return join(this.cacheDir, sanitizePath(sourceName));
  }

  /** Get directory for converted models of a section */
  getSectionConvertedDir(sectionName: string): string {
    return join(this.convertedDir, sanitizePath(sectionName));
  }

  /** Get directory for a build config's output */
  getConfigOutputDir(): string {
    if (this.configName) {
      return join(this.buildsDir, sanitizePath(this.configName));
    }
    return this.buildsDir;
  }

  /** Get path for the final NWD of this config */
  getConfigOutputPath(): string {
    const name = this.configName || 'federated';
    return join(this.getConfigOutputDir(), `${sanitizePath(name)}.nwd`);
  }

  async initialize(): Promise<void> {
    // Create base directories
    await mkdir(this.cacheDir, { recursive: true });
    await mkdir(this.convertedDir, { recursive: true });
    await mkdir(this.getConfigOutputDir(), { recursive: true });
    if (this.settings.archiveRvtVersions > 0) {
      await mkdir(this.archiveRvtDir, { recursive: true });
    }
    if (this.settings.archiveNwdVersions > 0) {
      await mkdir(this.archiveNwdDir, { recursive: true });
    }
  }

  setDownloadedPath(modelId: string, path: string): void {
    this.downloadedFiles.set(modelId, path);
  }

  getDownloadedPath(modelId: string): string | undefined {
    return this.downloadedFiles.get(modelId);
  }

  setConvertedPath(modelId: string, path: string): void {
    this.convertedFiles.set(modelId, path);
  }

  getConvertedPath(modelId: string): string | undefined {
    return this.convertedFiles.get(modelId);
  }

  setSectionPath(sectionId: string, path: string): void {
    this.sectionFiles.set(sectionId, path);
  }

  getSectionPath(sectionId: string): string | undefined {
    return this.sectionFiles.get(sectionId);
  }

  getAllConvertedPaths(): string[] {
    return Array.from(this.convertedFiles.values());
  }

  getAllSectionPaths(): string[] {
    return Array.from(this.sectionFiles.values());
  }
}
