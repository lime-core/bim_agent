import { copyFile, readdir, unlink, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { logger } from './logger';

/**
 * Get today's date formatted as YYYY_MM_DD
 */
function getDateSuffix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}_${m}_${d}`;
}

/**
 * Archive a file before it gets overwritten.
 *
 * Creates: {archiveDir}/{baseName}_{YYYY_MM_DD}.{ext}
 * If an archive for today already exists, it gets overwritten (one copy per day).
 *
 * @param sourceFile - The current file that will be overwritten
 * @param archiveDir - Directory to store archived copies
 * @param maxVersions - Maximum number of archived versions to keep (0 = no archiving)
 */
export async function archiveFile(
  sourceFile: string,
  archiveDir: string,
  maxVersions: number
): Promise<void> {
  if (maxVersions <= 0) return;

  // Check source exists
  try {
    await stat(sourceFile);
  } catch {
    // Source doesn't exist — nothing to archive
    return;
  }

  const ext = extname(sourceFile);
  const base = basename(sourceFile, ext);
  const dateSuffix = getDateSuffix();
  const archiveName = `${base}_${dateSuffix}${ext}`;
  const archivePath = join(archiveDir, archiveName);

  try {
    // Copy current file to archive (overwrites today's version if exists)
    await copyFile(sourceFile, archivePath);
    logger.info(`Archived: ${basename(sourceFile)} → ${archiveName}`);

    // Rotate: remove oldest versions beyond maxVersions
    await rotateArchives(archiveDir, base, ext, maxVersions);
  } catch (error) {
    logger.error(`Failed to archive ${sourceFile}: ${error}`);
  }
}

/**
 * Remove oldest archive versions for a given file beyond the limit.
 *
 * Matches files like: {base}_{YYYY_MM_DD}.{ext}
 * Sorts by date suffix descending, removes excess.
 */
async function rotateArchives(
  archiveDir: string,
  baseName: string,
  ext: string,
  maxVersions: number
): Promise<void> {
  try {
    const files = await readdir(archiveDir);

    // Pattern: baseName_YYYY_MM_DD.ext
    const datePattern = /^(.+)_(\d{4}_\d{2}_\d{2})(\..+)$/;
    const matching = files
      .filter((f) => {
        const match = f.match(datePattern);
        if (!match) return false;
        return match[1] === baseName && match[3] === ext;
      })
      .sort()
      .reverse(); // newest first (lexicographic sort on YYYY_MM_DD works)

    // Remove oldest beyond limit
    const toRemove = matching.slice(maxVersions);
    for (const f of toRemove) {
      await unlink(join(archiveDir, f));
      logger.info(`Rotated archive: ${f}`);
    }
  } catch (error) {
    logger.error(`Failed to rotate archives in ${archiveDir}: ${error}`);
  }
}
