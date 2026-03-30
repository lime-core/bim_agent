import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

export class BuildContext {
  readonly buildId: string;
  readonly baseDir: string;
  readonly downloadsDir: string;
  readonly convertedDir: string;
  readonly outputDir: string;

  private downloadedFiles = new Map<string, string>();
  private convertedFiles = new Map<string, string>();
  private sectionFiles = new Map<string, string>();

  constructor(workDir: string, buildId: string) {
    this.buildId = buildId;
    // Resolve to absolute path — Navisworks requires absolute paths
    this.baseDir = resolve(workDir, 'builds', buildId);
    this.downloadsDir = join(this.baseDir, 'downloads');
    this.convertedDir = join(this.baseDir, 'converted');
    this.outputDir = join(this.baseDir, 'output');
  }

  async initialize(): Promise<void> {
    await mkdir(this.downloadsDir, { recursive: true });
    await mkdir(this.convertedDir, { recursive: true });
    await mkdir(this.outputDir, { recursive: true });
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
