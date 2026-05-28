import type { AgentCapability } from './types.js';

export const AGENT_VERSION = '0.2.1';

export const AGENT_CAPABILITIES: AgentCapability[] = [
  'build.download_changed_models',
  'build.convert_rvt_to_nwd',
  'build.assemble_sections',
  'build.assemble_final',
  'data_source.scan',
  'artifact.section_model_cache',
  'artifact.preflight',
  'artifact.cleanup',
  'artifact.cleanup_selected',
];
