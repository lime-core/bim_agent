import 'dotenv/config';

export interface AgentConfig {
  serverUrl: string;
  apiKey: string;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  workDir: string;
  autodeskBasePath: string;
  navisworksLang: string;
  processTimeoutMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[FATAL] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): AgentConfig {
  return {
    serverUrl: requireEnv('SERVER_URL').replace(/\/+$/, ''),
    apiKey: requireEnv('API_KEY'),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
    workDir: process.env.WORK_DIR || './work',
    autodeskBasePath: process.env.AUTODESK_BASE_PATH || 'C:\\Program Files\\Autodesk',
    navisworksLang: process.env.NAVISWORKS_LANG || 'ru-RU',
    processTimeoutMs: parseInt(process.env.PROCESS_TIMEOUT_MS || '3600000', 10),
  };
}

/**
 * Resolve path to FileToolsTaskRunner.exe based on Revit version.
 * Pattern: {autodeskBasePath}\Navisworks Manage {version}\FileToolsTaskRunner.exe
 */
export function getNavisworksPath(config: AgentConfig, revitVersion: string): string {
  return `${config.autodeskBasePath}\\Navisworks Manage ${revitVersion}\\FileToolsTaskRunner.exe`;
}

/**
 * Resolve path to RevitServerTool.exe based on Revit version.
 * Pattern: {autodeskBasePath}\Revit {version}\RevitServerToolCommand\RevitServerTool.exe
 */
export function getRevitToolPath(config: AgentConfig, revitVersion: string): string {
  return `${config.autodeskBasePath}\\Revit ${revitVersion}\\RevitServerToolCommand\\RevitServerTool.exe`;
}
