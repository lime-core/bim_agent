/**
 * API contract types mirroring EIR server schemas.
 */

// --- Enums (mirror lib/db/schema/enums.ts) ---

export type BuildStatus =
  | 'queued'
  | 'downloading'
  | 'converting'
  | 'assembling_sections'
  | 'assembling_final'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BuildStepType = 'download' | 'convert_rvt_nwd' | 'assemble_section' | 'assemble_final';

export type BuildStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type AgentStatus = 'online' | 'offline' | 'busy';

// --- API Response Types ---

export interface ModelDataSource {
  name: string | null;
  type: 'revit_server' | 'folder';
  folderPath: string | null;
  serverAddress: string | null;
  serverPath: string | null;
  revitVersion: string | null;
}

export interface AssemblySettings {
  outputPath: string | null;
  archiveRvtVersions: number;
  archiveNwdVersions: number;
}

export interface BuildStep {
  id: string;
  buildId: string;
  stepType: BuildStepType;
  stepOrder: number;
  status: BuildStepStatus;
  progress: number;
  logOutput: string | null;
  errorMessage: string | null;
  modelId: string | null;
  sectionId: string | null;
  // Для assemble_section: NWD-пути моделей, которые не конвертировались в этом билде
  // (кэш с предыдущей сборки). Агент добавляет их к новосконвертированным.
  cachedModelNwdPaths: string[];
  model?: {
    id: string;
    fileName: string;
    filePath: string;
    sectionId: string | null;
    dataSource: ModelDataSource | null;
  } | null;
  section?: { id: string; name: string; code: string } | null;
}

export interface Build {
  id: string;
  projectId: string;
  configName: string | null;
  status: BuildStatus;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  assemblySettings: AssemblySettings | null;
  // ВСЕ разделы конфига (включая неизменённые) — для финальной сборки
  allSections: Array<{ id: string; code: string; name: string }>;
  // NWD-пути кэшированных безраздельных моделей — для финальной сборки
  cachedUnassignedNwdPaths: string[];
  steps: BuildStep[];
}

export interface PendingBuildsResponse {
  builds: Build[];
}

// --- API Request Types ---

export interface HeartbeatRequest {
  status: AgentStatus;
}

export interface ProgressReport {
  buildStatus?: BuildStatus;
  buildErrorMessage?: string;
  stepId?: string;
  status?: BuildStepStatus;
  progress?: number;
  logOutput?: string;
  errorMessage?: string;
  modelId?: string;
  modelStatus?: string;
  // Путь к выходному NWD после convert_rvt_nwd шага (сохраняется в lastBuiltNwdPath)
  modelNwdPath?: string;
  // Пути кэшированных NWD, которые оказались отсутствующими или повреждёнными.
  // Сервер сбросит lastBuiltNwdPath для этих моделей и пометит их как 'error'.
  invalidatedNwdPaths?: string[];
}

// --- Script Runner ---

export interface StepResult {
  success: boolean;
  output: string;
  errorMessage?: string;
  outputPath?: string;
  // Кэшированные NWD, которые оказались отсутствующими или повреждёнными при выполнении шага
  invalidatedPaths?: string[];
}

// --- Agent Commands ---

export type AgentCommandType = 'scan_data_source' | 'test_connection';

export type AgentCommandStatus = 'pending' | 'running' | 'completed' | 'failed' | 'expired';

export interface DataSourceInfo {
  id: string | null;
  type: 'revit_server' | 'folder';
  serverAddress: string | null;
  serverPath: string | null;
  serverUsername: string | null;
  serverPassword: string | null;
  folderPath: string | null;
  revitVersion: string | null;
}

export interface AgentCommand {
  id: string;
  commandType: AgentCommandType;
  dataSource: DataSourceInfo;
}

export interface PendingCommandsResponse {
  commands: AgentCommand[];
}

export interface VersionHistoryEntry {
  versionNumber: number;
  modelSize: number;
  supportSize: number;
  date: string;
  user: string;
  comment: string;
}

export interface ScanFileEntry {
  fileName: string;
  filePath: string;
  fileSize?: number;
  lastModifiedAt?: string;
  // RS-specific fields
  versionNumber?: number;
  publishedBy?: string;
  comment?: string;
  supportSize?: number;
  versionHistory?: VersionHistoryEntry[];
}

export interface CommandResult {
  status: 'completed' | 'failed';
  result?: { files?: ScanFileEntry[]; message?: string };
  errorMessage?: string;
}
