import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OLLAMA_ENDPOINT,
  createOllamaProfile,
  emptyAssistantSettings,
} from './assistant-settings';

describe('assistant settings contract', () => {
  it('starts with no provider and a safe loopback default for explicit setup', () => {
    expect(emptyAssistantSettings()).toEqual({ schemaVersion: 1, ollamaProfiles: [] });
    expect(createOllamaProfile(2)).toMatchObject({
      name: 'Ollama 2',
      endpoint: DEFAULT_OLLAMA_ENDPOINT,
      allowPrivateNetwork: false,
    });
  });

  it('does not expose a user endpoint or model in a source-level default', () => {
    expect(DEFAULT_OLLAMA_ENDPOINT).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_OLLAMA_ENDPOINT).not.toContain('192.168.');
  });
});
