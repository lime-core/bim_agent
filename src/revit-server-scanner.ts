import crypto from 'node:crypto';
import { logger } from './logger.js';
import type { ScanFileEntry, DataSourceInfo, VersionHistoryEntry } from './types.js';

/**
 * Revit Server REST API scanner.
 *
 * Revit Server exposes a REST API at:
 *   http://{host}/RevitServerAdminRestService{version}/AdminRESTService.svc/
 *
 * Key endpoints:
 *   GET /{path}/contents       — list folder contents (folders + models)
 *   GET /{path}/modelinfo      — get model details
 *
 * The serverAddress field should be the host (IP or DNS name), e.g. "192.168.1.10"
 * The serverPath is the root folder to scan, e.g. "Projects\260620\АР"
 */

// Revit Server API versions (match Revit version)
const VERSION_MAP: Record<string, string> = {
  '2019': '2019',
  '2020': '2020',
  '2021': '2021',
  '2022': '2022',
  '2023': '2023',
  '2024': '2024',
  '2025': '2025',
  '2026': '2026',
};

interface FolderContents {
  Path: string;
  DriveFreeSpace: number;
  DriveSpace: number;
  Folders: FolderEntry[];
  Models: ModelEntry[];
  /** Old API versions may use 'Files' */
  Files?: ModelEntry[];
}

interface FolderEntry {
  Name: string;
  Size: number;
  HasContents: boolean;
  LockState: number;
  LockContext: string | null;
}

interface ModelEntry {
  Name: string;
  Size: number;
  ModelSize: number;
  SupportSize: number;
  LockState: number;
  LockContext: string | null;
  ProductVersion?: number;
  Date?: string;
}

interface RevitServerConfig {
  host: string;
  basePath: string;
  revitVersion: string;
  username: string | null;
  password: string | null;
}

function buildBaseUrl(config: RevitServerConfig): string {
  const host = config.host.replace(/\/+$/, '');
  const version = VERSION_MAP[config.revitVersion] || config.revitVersion || '2024';
  // If host includes protocol, use as-is; otherwise add http://
  const fullHost = host.includes('://') ? host : `http://${host}`;
  return `${fullHost}/RevitServerAdminRestService${version}/AdminRESTService.svc`;
}

function buildHeaders(config: RevitServerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Name': config.username || 'EIR-Agent',
    'User-Machine-Name': 'EIR-Server',
    'Operation-GUID': crypto.randomUUID(),
  };

  if (config.username && config.password) {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  return headers;
}

/** Normalize path separators: backslash → forward slash, trim leading/trailing slashes */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

async function fetchContents(
  baseUrl: string,
  headers: Record<string, string>,
  folderPath: string
): Promise<FolderContents> {
  const normalizedPath = normalizePath(folderPath);
  // Revit Server REST API uses "|" as path separator: "|folder|subfolder"
  // For root (empty path), no pipe prefix needed — just "/contents"
  const pipePath = normalizedPath
    ? '|' + normalizedPath.split('/').map(encodeURIComponent).join('|')
    : '';
  const url = `${baseUrl}${pipePath ? `/${pipePath}` : ''}/contents`;

  logger.debug(`Revit Server API: GET ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Revit Server API error ${response.status}: ${text || response.statusText}`);
  }

  return response.json();
}

interface HistoryResponse {
  Path: string;
  Items: HistoryItem[];
}

interface HistoryItem {
  VersionNumber: number;
  ModelSize: number;
  SupportSize: number;
  Date: string;
  User: string;
  Comment: string;
  OverwrittenByHistoryNumber: number;
}

/** Parse RS date format "/Date(milliseconds)/" to ISO string */
function parseRsDate(dateStr: string): string {
  const match = dateStr.match(/\/Date\((\d+)\)\//);
  if (!match) return dateStr;
  return new Date(parseInt(match[1], 10)).toISOString();
}

async function fetchHistory(
  baseUrl: string,
  headers: Record<string, string>,
  modelPath: string
): Promise<VersionHistoryEntry[]> {
  const normalizedPath = normalizePath(modelPath);
  const pipePath = normalizedPath
    ? '|' + normalizedPath.split('/').map(encodeURIComponent).join('|')
    : '';
  const url = `${baseUrl}${pipePath ? `/${pipePath}` : ''}/history`;

  logger.debug(`Revit Server API: GET ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Revit Server history API error ${response.status}: ${text || response.statusText}`
    );
  }

  const data: HistoryResponse = await response.json();

  return (data.Items || []).map((item) => ({
    versionNumber: item.VersionNumber,
    modelSize: item.ModelSize,
    supportSize: item.SupportSize,
    date: parseRsDate(item.Date),
    user: item.User,
    comment: item.Comment || '',
  }));
}

/**
 * Test connection to Revit Server by fetching the root path contents.
 * Throws on failure.
 */
export async function testRevitServerConnection(dataSource: DataSourceInfo): Promise<string> {
  const config: RevitServerConfig = {
    host: dataSource.serverAddress || '',
    basePath: dataSource.serverPath || '',
    revitVersion: dataSource.revitVersion || '2024',
    username: dataSource.serverUsername || null,
    password: dataSource.serverPassword || null,
  };

  if (!config.host) throw new Error('Server address is required');

  const baseUrl = buildBaseUrl(config);
  const headers = buildHeaders(config);
  const path = config.basePath || '';

  const contents = await fetchContents(baseUrl, headers, path);

  const modelCount = (contents.Models || contents.Files || []).length;
  const folderCount = (contents.Folders || []).length;

  return `OK: ${modelCount} models, ${folderCount} subfolders at /${normalizePath(path)}`;
}

/**
 * Recursively scan Revit Server for .rvt models.
 */
export async function scanRevitServer(dataSource: DataSourceInfo): Promise<ScanFileEntry[]> {
  const config: RevitServerConfig = {
    host: dataSource.serverAddress || '',
    basePath: dataSource.serverPath || '',
    revitVersion: dataSource.revitVersion || '2024',
    username: dataSource.serverUsername || null,
    password: dataSource.serverPassword || null,
  };

  if (!config.host) throw new Error('Server address is required');

  const baseUrl = buildBaseUrl(config);
  const headers = buildHeaders(config);
  const rootPath = normalizePath(config.basePath || '');

  const files: ScanFileEntry[] = [];
  await scanFolderRecursive(baseUrl, headers, rootPath, rootPath, files);

  logger.info(
    `Revit Server scan complete: found ${files.length} model(s) at ${config.host}/${rootPath}`
  );
  return files;
}

async function scanFolderRecursive(
  baseUrl: string,
  headers: Record<string, string>,
  rootPath: string,
  currentPath: string,
  results: ScanFileEntry[]
): Promise<void> {
  let contents: FolderContents;
  try {
    contents = await fetchContents(baseUrl, headers, currentPath);
  } catch (err) {
    logger.warn(`Failed to list ${currentPath}: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Process models
  const models = contents.Models || contents.Files || [];
  for (const model of models) {
    // Revit Server models are .rvt by convention (no extension in API name)
    const fileName = model.Name.endsWith('.rvt') ? model.Name : `${model.Name}.rvt`;
    // Relative path from root
    const fullPath =
      currentPath === rootPath ? fileName : `${currentPath.slice(rootPath.length + 1)}/${fileName}`;
    // Full path on RS for /history call
    const rsModelPath = `${currentPath}/${fileName}`;

    // Fetch version history for this model
    let versionHistory: VersionHistoryEntry[] = [];
    try {
      versionHistory = await fetchHistory(baseUrl, headers, rsModelPath);
      logger.debug(`Model ${fileName}: ${versionHistory.length} version(s)`);
    } catch (err) {
      logger.warn(
        `Failed to fetch history for ${fileName}: ${err instanceof Error ? err.message : err}`
      );
    }

    const latestVersion =
      versionHistory.length > 0
        ? versionHistory.reduce(
            (max, v) => (v.versionNumber > max.versionNumber ? v : max),
            versionHistory[0]
          )
        : null;

    results.push({
      fileName,
      filePath: normalizePath(fullPath),
      fileSize: model.ModelSize || model.Size || undefined,
      lastModifiedAt: latestVersion
        ? latestVersion.date
        : model.Date
          ? parseRsDate(model.Date)
          : undefined,
      versionNumber: latestVersion?.versionNumber,
      publishedBy: latestVersion?.user,
      comment: latestVersion?.comment,
      supportSize: model.SupportSize || undefined,
      versionHistory: versionHistory.length > 0 ? versionHistory : undefined,
    });
  }

  // Recurse into subfolders
  for (const folder of contents.Folders || []) {
    const subPath = `${currentPath}/${folder.Name}`;
    await scanFolderRecursive(baseUrl, headers, rootPath, subPath, results);
  }
}
