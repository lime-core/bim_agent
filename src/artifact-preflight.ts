import { access, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  ArtifactCleanupPayload,
  ArtifactCleanupResult,
  ArtifactFileEntry,
  ArtifactPreflightPayload,
  ArtifactPreflightResult,
  ExpectedAssemblyArtifact,
} from './types.js';

const MANAGED_ROOTS = ['Кэш', 'Сконвертированные', 'Сборки', 'Архив'];
const MAX_LIST_ITEMS = 200;
const MAX_WALK_FILES = 10_000;

interface WalkedFile {
  relativePath: string;
  size: number;
  modifiedAt: string;
}

function normalizeRelativePath(input: string): string {
  if (input.startsWith('/') || input.startsWith('\\')) {
    throw new Error(`Expected relative path, got absolute path: ${input}`);
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');

  if (
    normalized.includes('\0') ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    parts.includes('..') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe relative path: ${input}`);
  }

  return parts.join('/');
}

function resolveInsideRoot(rootPath: string, relativePath: string): string {
  const safeRelativePath = normalizeRelativePath(relativePath);
  if (isAbsolute(safeRelativePath)) {
    throw new Error(`Expected relative path, got absolute path: ${relativePath}`);
  }

  const resolvedRoot = resolve(rootPath);
  const resolvedTarget = resolve(resolvedRoot, safeRelativePath);
  const diff = relative(resolvedRoot, resolvedTarget);

  if (diff && (diff.startsWith('..') || isAbsolute(diff))) {
    throw new Error(`Path escapes output folder: ${relativePath}`);
  }

  return resolvedTarget;
}

function relativeFromRoot(rootPath: string, absolutePath: string): string {
  return relative(resolve(rootPath), absolutePath).split(sep).join('/');
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    const info = await stat(absolutePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function keyPath(relativePath: string): string {
  return normalizeRelativePath(relativePath).toLocaleLowerCase();
}

function toEntry(
  artifact: Pick<ExpectedAssemblyArtifact, 'relativePath' | 'type' | 'label'>,
  file?: Pick<WalkedFile, 'size' | 'modifiedAt'>,
  reason?: string
): ArtifactFileEntry {
  return {
    relativePath: normalizeRelativePath(artifact.relativePath),
    type: artifact.type,
    label: artifact.label,
    ...(file && { size: file.size, modifiedAt: file.modifiedAt }),
    ...(reason && { reason }),
  };
}

async function walkFiles(
  rootPath: string,
  currentPath: string,
  files: WalkedFile[],
  maxFiles: number
): Promise<void> {
  if (files.length >= maxFiles) return;

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const absolutePath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkFiles(rootPath, absolutePath, files, maxFiles);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const info = await stat(absolutePath);
      files.push({
        relativePath: relativeFromRoot(rootPath, absolutePath),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch {
      // Ignore files that disappeared while walking.
    }
  }
}

async function walkManagedFiles(
  outputPath: string
): Promise<{ files: WalkedFile[]; truncated: boolean }> {
  const files: WalkedFile[] = [];

  for (const rootName of MANAGED_ROOTS) {
    const root = resolveInsideRoot(outputPath, rootName);
    try {
      const info = await stat(root);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }

    await walkFiles(outputPath, root, files, MAX_WALK_FILES);
    if (files.length >= MAX_WALK_FILES) {
      return { files, truncated: true };
    }
  }

  return { files, truncated: false };
}

function pushLimited<T>(target: T[], item: T): void {
  if (target.length < MAX_LIST_ITEMS) target.push(item);
}

function isTemporaryInput(relativePath: string): boolean {
  const fileName = basename(relativePath);
  return fileName.startsWith('_input_') && fileName.endsWith('.txt');
}

function isGeneratedNwdCandidate(relativePath: string): boolean {
  const lower = relativePath.toLocaleLowerCase();
  return (
    (lower.startsWith('сконвертированные/') || lower.startsWith('сборки/')) &&
    extname(lower) === '.nwd'
  );
}

function isManagedCacheCandidate(relativePath: string): boolean {
  const lower = relativePath.toLocaleLowerCase();
  return lower.startsWith('кэш/') && extname(lower) === '.rvt';
}

function cleanupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function isSafeCleanupRelativePath(relativePath: string): boolean {
  return isTemporaryInput(relativePath);
}

async function nextAvailablePath(path: string): Promise<string> {
  if (!(await fileExists(path))) return path;

  const extension = extname(path);
  const base = extension ? path.slice(0, -extension.length) : path;

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}_${index}${extension}`;
    if (!(await fileExists(candidate))) return candidate;
  }

  throw new Error(`Cannot allocate quarantine path for ${path}`);
}

export async function preflightArtifacts(
  payload: ArtifactPreflightPayload
): Promise<ArtifactPreflightResult> {
  const outputPath = resolve(payload.outputPath);
  const expectedByKey = new Map<string, ExpectedAssemblyArtifact>();
  const presentExpected: ArtifactFileEntry[] = [];
  const missingExpected: ArtifactFileEntry[] = [];
  const safeDelete: ArtifactFileEntry[] = [];
  const staleCandidates: ArtifactFileEntry[] = [];
  const unknown: ArtifactFileEntry[] = [];
  let presentCount = 0;
  let missingCount = 0;
  let safeDeleteCount = 0;
  let staleCandidatesCount = 0;
  let unknownCount = 0;

  await mkdir(outputPath, { recursive: true });

  for (const artifact of payload.expectedArtifacts) {
    const relativePath = normalizeRelativePath(artifact.relativePath);
    const normalizedArtifact = { ...artifact, relativePath };
    expectedByKey.set(keyPath(relativePath), normalizedArtifact);

    const absolutePath = resolveInsideRoot(outputPath, relativePath);
    try {
      const info = await stat(absolutePath);
      if (info.isFile()) {
        presentCount += 1;
        pushLimited(
          presentExpected,
          toEntry(normalizedArtifact, {
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          })
        );
      } else {
        missingCount += 1;
        pushLimited(
          missingExpected,
          toEntry(normalizedArtifact, undefined, 'expected_file_missing')
        );
      }
    } catch {
      missingCount += 1;
      pushLimited(missingExpected, toEntry(normalizedArtifact, undefined, 'expected_file_missing'));
    }
  }

  const walked = await walkManagedFiles(outputPath);

  for (const file of walked.files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const expected = expectedByKey.get(keyPath(relativePath));
    if (expected) continue;

    const baseEntry: ArtifactFileEntry = {
      relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
    };

    if (isTemporaryInput(relativePath)) {
      safeDeleteCount += 1;
      pushLimited(safeDelete, {
        ...baseEntry,
        type: 'temporary',
        reason: 'temporary_input_file',
      });
      continue;
    }

    if (isGeneratedNwdCandidate(relativePath)) {
      staleCandidatesCount += 1;
      pushLimited(staleCandidates, {
        ...baseEntry,
        type: 'unknown',
        reason: 'managed_nwd_not_expected',
      });
      continue;
    }

    if (isManagedCacheCandidate(relativePath)) {
      staleCandidatesCount += 1;
      pushLimited(staleCandidates, {
        ...baseEntry,
        type: 'unknown',
        reason: 'managed_rvt_cache_not_expected',
      });
      continue;
    }

    unknownCount += 1;
    pushLimited(unknown, {
      ...baseEntry,
      type: 'unknown',
      reason: 'not_recognized_as_agent_artifact',
    });
  }

  return {
    outputPath,
    checkedAt: new Date().toISOString(),
    summary: {
      expected: payload.expectedArtifacts.length,
      present: presentCount,
      missing: missingCount,
      safeDelete: safeDeleteCount,
      staleCandidates: staleCandidatesCount,
      unknown: unknownCount,
      truncated: walked.truncated,
    },
    presentExpected,
    missingExpected,
    safeDelete,
    staleCandidates,
    unknown,
  };
}

export async function cleanupArtifacts(
  payload: ArtifactCleanupPayload
): Promise<ArtifactCleanupResult> {
  const outputPath = resolve(payload.outputPath);
  const quarantineRelativeRoot = `_Очистка/Карантин/${cleanupTimestamp()}`;
  const quarantineRoot = resolveInsideRoot(outputPath, quarantineRelativeRoot);
  const moved: ArtifactCleanupResult['moved'] = [];
  const failed: ArtifactCleanupResult['failed'] = [];

  await mkdir(quarantineRoot, { recursive: true });

  for (const inputPath of payload.relativePaths) {
    let relativePath: string;

    try {
      relativePath = normalizeRelativePath(inputPath);

      if (!isSafeCleanupRelativePath(relativePath)) {
        failed.push({
          relativePath,
          error: 'Файл не относится к безопасной автоматической очистке',
        });
        continue;
      }

      const sourcePath = resolveInsideRoot(outputPath, relativePath);
      const targetRelativePath = `${quarantineRelativeRoot}/${relativePath}`;
      const targetPath = await nextAvailablePath(resolveInsideRoot(outputPath, targetRelativePath));

      await mkdir(dirname(targetPath), { recursive: true });
      await rename(sourcePath, targetPath);

      moved.push({
        relativePath,
        quarantineRelativePath: relativeFromRoot(outputPath, targetPath),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ relativePath: inputPath, error: message });
    }
  }

  return {
    quarantinePath: relativeFromRoot(outputPath, quarantineRoot),
    moved,
    failed,
  };
}
