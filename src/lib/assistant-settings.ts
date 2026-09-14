import { persistAppSetting, readAppSetting } from './app-settings';

export const ASSISTANT_SETTINGS_KEY = 'assistant';
export const ASSISTANT_SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

export interface OllamaProfile {
  id: string;
  name: string;
  endpoint: string;
  allowPrivateNetwork: boolean;
  selectedModel?: string;
}

export interface AssistantSettings {
  schemaVersion: 1;
  activeOllamaProfileId?: string;
  ollamaProfiles: OllamaProfile[];
}

export function emptyAssistantSettings(): AssistantSettings {
  return { schemaVersion: ASSISTANT_SETTINGS_SCHEMA_VERSION, ollamaProfiles: [] };
}

export function createOllamaProfile(index = 1): OllamaProfile {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ollama-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: `Ollama ${index}`,
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    allowPrivateNetwork: false,
  };
}

export async function readAssistantSettings(): Promise<AssistantSettings> {
  const value = await readAppSetting<unknown>(ASSISTANT_SETTINGS_KEY);
  return normalizeAssistantSettings(value);
}

export function persistAssistantSettings(settings: AssistantSettings): void {
  persistAppSetting(ASSISTANT_SETTINGS_KEY, normalizeAssistantSettings(settings));
}

function normalizeAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== 'object') return emptyAssistantSettings();
  const record = value as Record<string, unknown>;
  const profiles = Array.isArray(record.ollamaProfiles)
    ? record.ollamaProfiles.map(normalizeProfile).filter((profile): profile is OllamaProfile => profile !== undefined).slice(0, 32)
    : [];
  const active = typeof record.activeOllamaProfileId === 'string'
    && profiles.some((profile) => profile.id === record.activeOllamaProfileId)
    ? record.activeOllamaProfileId
    : profiles[0]?.id;
  return {
    schemaVersion: ASSISTANT_SETTINGS_SCHEMA_VERSION,
    activeOllamaProfileId: active,
    ollamaProfiles: profiles,
  };
}

function normalizeProfile(value: unknown): OllamaProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim().slice(0, 128) : '';
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 128) : '';
  const endpoint = typeof record.endpoint === 'string' ? record.endpoint.trim().slice(0, 2048) : '';
  if (!id || !name || !endpoint) return undefined;
  const selectedModel = typeof record.selectedModel === 'string'
    ? record.selectedModel.trim().slice(0, 256) || undefined
    : undefined;
  return {
    id,
    name,
    endpoint,
    allowPrivateNetwork: record.allowPrivateNetwork === true,
    selectedModel,
  };
}
