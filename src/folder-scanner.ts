import { readdir, stat, access } from 'node:fs/promises';
import { join, relative, basename, extname } from 'node:path';
import { logger } from './logger.js';
import type { ScanFileEntry } from './types.js';

/**
 * Recursively scans a folder for .rvt files.
 * Returns relative paths within the folder.
 */
export async function scanFolder(folderPath: string): Promise<ScanFileEntry[]> {
  // Validate path exists and is a directory
  await access(folderPath);
  const folderStat = await stat(folderPath);

  if (!folderStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }

  const files: ScanFileEntry[] = [];
  await walkDir(folderPath, folderPath, files);

  logger.info(`Scan complete: found ${files.length} .rvt file(s) in ${folderPath}`);
  return files;
}

async function walkDir(
  rootPath: string,
  currentPath: string,
  results: ScanFileEntry[]
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkDir(rootPath, fullPath, results);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.rvt') {
      try {
        const fileStat = await stat(fullPath);
        results.push({
          fileName: basename(entry.name),
          filePath: relative(rootPath, fullPath).replace(/\\/g, '/'),
          fileSize: fileStat.size,
          lastModifiedAt: fileStat.mtime.toISOString(),
        });
      } catch (err) {
        logger.warn(`Could not stat file ${fullPath}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
