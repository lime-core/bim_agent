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
  type: 'revit_server' | 'folder';
  folderPath: string | null;
  serverAddress: string | null;
  serverPath: string | null;
  revitVersion: string | null;
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
  model?: {
    id: string;
    fileName: string;
    filePath: string;
    sectionId: string | null;
    dataSource: ModelDataSource | null;
  } | null;
  section?: { id: string; name: string } | null;
}

export interface Build {
  id: string;
  projectId: string;
  status: BuildStatus;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
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
}

// --- Script Runner ---

export interface StepResult {
  success: boolean;
  output: string;
  errorMessage?: string;
  outputPath?: string;
}

// --- Agent Commands ---

export type AgentCommandType = 'scan_data_source';

export type AgentCommandStatus = 'pending' | 'running' | 'completed' | 'failed' | 'expired';

export interface DataSourceInfo {
  id: string;
  type: 'revit_server' | 'folder';
  serverAddress: string | null;
  serverPath: string | null;
  folderPath: string | null;
}

export interface AgentCommand {
  id: string;
  commandType: AgentCommandType;
  dataSource: DataSourceInfo;
}

export interface PendingCommandsResponse {
  commands: AgentCommand[];
}

export interface ScanFileEntry {
  fileName: string;
  filePath: string;
  fileSize?: number;
  lastModifiedAt?: string;
}

export interface CommandResult {
  status: 'completed' | 'failed';
  result?: { files: ScanFileEntry[] };
  errorMessage?: string;
}
