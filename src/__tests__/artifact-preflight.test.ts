import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupArtifacts } from '../artifact-preflight.js';
import type { ExpectedAssemblyArtifact } from '../types.js';

let tempRoots: string[] = [];

async function makeOutputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eir-artifacts-'));
  tempRoots.push(root);
  return root;
}

async function writeArtifact(root: string, relativePath: string, content = 'artifact') {
  const absolutePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return absolutePath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe('cleanupArtifacts', () => {
  it('moves selected stale NWD files when they are outside expected artifact paths', async () => {
    const outputPath = await makeOutputRoot();
    const stalePath = 'Сконвертированные/АР — Старый раздел/_Модели/model.nwd';
    const expectedArtifacts: ExpectedAssemblyArtifact[] = [
      {
        type: 'model_nwd',
        relativePath: 'Сконвертированные/АР — Новый раздел/_Модели/model.nwd',
        label: 'model.rvt',
      },
    ];

    const sourcePath = await writeArtifact(outputPath, stalePath, 'old nwd');
    const result = await cleanupArtifacts({
      outputPath,
      relativePaths: [stalePath],
      expectedArtifacts,
    });

    expect(result.failed).toEqual([]);
    expect(result.moved).toHaveLength(1);
    expect(await fileExists(sourcePath)).toBe(false);
    expect(
      await readFile(join(outputPath, ...result.moved[0].quarantineRelativePath.split('/')), 'utf8')
    ).toBe('old nwd');
  });

  it('moves selected managed final NWD, section NWD, and RVT cache files to quarantine', async () => {
    const outputPath = await makeOutputRoot();
    const stalePaths = [
      'Сборки/Старая сборка/final.nwd',
      'Сконвертированные/КР — Старый раздел/section.nwd',
      'Кэш/Удаленная модель/model.rvt',
    ];

    await Promise.all(
      stalePaths.map((relativePath, index) =>
        writeArtifact(outputPath, relativePath, `old-${index}`)
      )
    );

    const result = await cleanupArtifacts({
      outputPath,
      relativePaths: stalePaths,
      expectedArtifacts: [
        {
          type: 'final_nwd',
          relativePath: 'Сборки/Актуальная сборка/final.nwd',
          label: 'Актуальная сборка',
        },
      ],
    });

    expect(result.failed).toEqual([]);
    expect(result.moved.map((item) => item.relativePath).sort()).toEqual([...stalePaths].sort());

    for (const moved of result.moved) {
      expect(await fileExists(join(outputPath, ...moved.relativePath.split('/')))).toBe(false);
      expect(await fileExists(join(outputPath, ...moved.quarantineRelativePath.split('/')))).toBe(
        true
      );
    }
  });

  it('does not move current expected NWD files even if they are selected', async () => {
    const outputPath = await makeOutputRoot();
    const currentPath = 'Сконвертированные/ОВ — Отопление/_Модели/current.nwd';
    const sourcePath = await writeArtifact(outputPath, currentPath, 'current nwd');
    const expectedArtifacts: ExpectedAssemblyArtifact[] = [
      {
        type: 'model_nwd',
        relativePath: currentPath,
        label: 'current.rvt',
      },
    ];

    const result = await cleanupArtifacts({
      outputPath,
      relativePaths: [currentPath],
      expectedArtifacts,
    });

    expect(result.moved).toEqual([]);
    expect(result.failed[0]).toMatchObject({
      relativePath: currentPath,
      error: 'Файл является актуальным ожидаемым артефактом',
    });
    expect(await fileExists(sourcePath)).toBe(true);
  });

  it('keeps legacy temporary cleanup compatible without expected artifacts', async () => {
    const outputPath = await makeOutputRoot();
    const tempPath = 'Сконвертированные/ОВ — Отопление/_input_123.txt';
    const sourcePath = await writeArtifact(outputPath, tempPath, 'temp');

    const result = await cleanupArtifacts({ outputPath, relativePaths: [tempPath] });

    expect(result.failed).toEqual([]);
    expect(result.moved).toHaveLength(1);
    expect(await fileExists(sourcePath)).toBe(false);
  });

  it('refuses unknown user files', async () => {
    const outputPath = await makeOutputRoot();
    const unknownPath = 'Сконвертированные/ОВ — Отопление/readme.txt';
    const sourcePath = await writeArtifact(outputPath, unknownPath, 'keep');

    const result = await cleanupArtifacts({ outputPath, relativePaths: [unknownPath] });

    expect(result.moved).toEqual([]);
    expect(result.failed[0]).toMatchObject({
      relativePath: unknownPath,
      error: 'Файл не относится к выбранной безопасной очистке',
    });
    expect(await fileExists(sourcePath)).toBe(true);
  });
});
