<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createOllamaProfile,
    emptyAssistantSettings,
    persistAssistantSettings,
    readAssistantSettings,
    type AssistantSettings,
    type OllamaProfile,
  } from '../lib/assistant-settings';
  import {
    discoverOllama,
    isTauri,
    requestOllamaFeedback,
    testOllamaModel,
  } from '../lib/ipc';
  import type { OllamaDiscovery, OllamaFeedback, OllamaGenerationOptions, OllamaModel } from '../lib/types';

  const MAX_CONTEXT_BYTES = 512 * 1024;

  let {
    source = '',
    selectedText = '',
    fileName = 'current Markdown file',
    onStatus = () => undefined,
  }: {
    source?: string;
    selectedText?: string;
    fileName?: string;
    onStatus?: (message: string) => void;
  } = $props();

  let settings = $state<AssistantSettings>(emptyAssistantSettings());
  let settingsOpen = $state(true);
  let loadingSettings = $state(true);
  let profileName = $state('');
  let endpoint = $state('');
  let allowPrivateNetwork = $state(false);
  let selectedModel = $state('');
  let contextChoice = $state<'none' | 'selection' | 'file'>('none');
  let prompt = $state('');
  let temperature = $state('');
  let topP = $state('');
  let topK = $state('');
  let numCtx = $state('');
  let numPredict = $state('');
  let seed = $state('');
  let think = $state(false);
  let discovery = $state<OllamaDiscovery | null>(null);
  let feedback = $state<OllamaFeedback | null>(null);
  let errorMessage = $state('');
  let busy = $state<'refreshing' | 'testing' | 'sending' | ''>('');
  let testedModelKey = $state('');
  let expandedModel = $state('');
  let destroyed = false;

  let activeProfile = $derived(settings.ollamaProfiles.find((profile) => profile.id === settings.activeOllamaProfileId));
  let models = $derived(discovery?.models ?? []);
  let selectedModelDetails = $derived(models.find((model) => model.name === selectedModel));
  let selectedContext = $derived(contextChoice === 'selection' ? selectedText : contextChoice === 'file' ? source : '');
  let selectedContextBytes = $derived(byteLength(selectedContext));
  let selectedModelKey = $derived(activeProfile ? `${activeProfile.id}:${selectedModel}` : '');
  let selectedModelReady = $derived(testedModelKey === selectedModelKey);
  let canSend = $derived(Boolean(
    isTauri
      && !busy
      && selectedModel
      && selectedModelReady
      && prompt.trim()
      && selectedContextBytes <= MAX_CONTEXT_BYTES,
  ));

  onMount(() => {
    void loadSettings();
    return () => {
      destroyed = true;
    };
  });

  async function loadSettings() {
    const loaded = await readAssistantSettings();
    if (destroyed) return;
    settings = loaded;
    syncDraftFromActiveProfile();
    settingsOpen = settings.ollamaProfiles.length === 0;
    loadingSettings = false;
  }

  function syncDraftFromActiveProfile() {
    const profile = settings.ollamaProfiles.find((item) => item.id === settings.activeOllamaProfileId);
    profileName = profile?.name ?? '';
    endpoint = profile?.endpoint ?? '';
    allowPrivateNetwork = profile?.allowPrivateNetwork ?? false;
    selectedModel = profile?.selectedModel ?? '';
    discovery = null;
    feedback = null;
    testedModelKey = '';
    errorMessage = '';
  }

  function addProfile() {
    const profile = createOllamaProfile(settings.ollamaProfiles.length + 1);
    settings = {
      ...settings,
      activeOllamaProfileId: profile.id,
      ollamaProfiles: [...settings.ollamaProfiles, profile],
    };
    persistAssistantSettings(settings);
    syncDraftFromActiveProfile();
    settingsOpen = true;
  }

  function selectProfile(id: string) {
    settings = { ...settings, activeOllamaProfileId: id };
    persistAssistantSettings(settings);
    syncDraftFromActiveProfile();
  }

  function saveProfile() {
    const profile = activeProfile;
    if (!profile) return addProfile();
    const next: OllamaProfile = {
      ...profile,
      name: profileName.trim().slice(0, 128) || 'Ollama',
      endpoint: endpoint.trim().slice(0, 2048),
      allowPrivateNetwork,
      selectedModel: selectedModel.trim().slice(0, 256) || undefined,
    };
    settings = {
      ...settings,
      activeOllamaProfileId: next.id,
      ollamaProfiles: settings.ollamaProfiles.map((item) => item.id === next.id ? next : item),
    };
    persistAssistantSettings(settings);
    discovery = null;
    testedModelKey = '';
    errorMessage = '';
    settingsOpen = false;
    onStatus('Ollama profile saved; refresh it to discover installed models');
  }

  function removeProfile() {
    const profile = activeProfile;
    if (!profile || !confirm(`Remove the ${profile.name} profile from Markdown Desktop? This does not delete models from Ollama.`)) return;
    const remaining = settings.ollamaProfiles.filter((item) => item.id !== profile.id);
    settings = {
      ...settings,
      activeOllamaProfileId: remaining[0]?.id,
      ollamaProfiles: remaining,
    };
    persistAssistantSettings(settings);
    syncDraftFromActiveProfile();
    settingsOpen = remaining.length === 0;
  }

  async function refreshModels() {
    if (!activeProfile || !endpoint.trim()) {
      settingsOpen = true;
      errorMessage = 'Save an Ollama endpoint before refreshing models.';
      return;
    }
    if (!isTauri) {
      errorMessage = 'Model discovery is available in the Markdown Desktop app, not the browser preview.';
      return;
    }
    busy = 'refreshing';
    errorMessage = '';
    feedback = null;
    try {
      const result = await discoverOllama(endpoint.trim(), allowPrivateNetwork, discovery?.resolvedAddress);
      discovery = result;
      const current = result.models.find((model) => model.name === selectedModel && model.chatSuitability !== 'embeddingOnly' && model.chatSuitability !== 'unsupported');
      selectedModel = current?.name ?? result.models.find((model) => model.chatSuitability === 'unverified')?.name ?? '';
      testedModelKey = '';
      expandedModel = selectedModel;
      onStatus(`Discovered ${result.models.length} installed Ollama model${result.models.length === 1 ? '' : 's'}${result.serverVersion ? ` (server ${result.serverVersion})` : ''}`);
    } catch (error) {
      errorMessage = friendlyError(error);
      onStatus(errorMessage);
    } finally {
      busy = '';
    }
  }

  async function testSelectedModel() {
    if (!activeProfile || !selectedModel || !discovery) return;
    busy = 'testing';
    errorMessage = '';
    try {
      const result = await testOllamaModel(endpoint.trim(), selectedModel, allowPrivateNetwork, discovery.resolvedAddress);
      testedModelKey = selectedModelKey;
      onStatus(result.message);
    } catch (error) {
      testedModelKey = '';
      errorMessage = friendlyError(error);
      onStatus(errorMessage);
    } finally {
      busy = '';
    }
  }

  async function sendFeedback() {
    if (!activeProfile || !canSend || !discovery) return;
    busy = 'sending';
    errorMessage = '';
    feedback = null;
    try {
      feedback = await requestOllamaFeedback(
        endpoint.trim(),
        selectedModel,
        prompt,
        selectedContext,
        allowPrivateNetwork,
        discovery.resolvedAddress,
        generationOptions(),
        think && Boolean(selectedModelDetails?.capabilities.includes('thinking')) ? true : undefined,
      );
      onStatus('Ollama returned read-only Markdown feedback');
    } catch (error) {
      errorMessage = friendlyError(error);
      onStatus(errorMessage);
    } finally {
      busy = '';
    }
  }

  function generationOptions(): OllamaGenerationOptions {
    return {
      temperature: numberOrUndefined(temperature),
      topP: numberOrUndefined(topP),
      topK: integerOrUndefined(topK),
      numCtx: integerOrUndefined(numCtx),
      numPredict: integerOrUndefined(numPredict),
      seed: integerOrUndefined(seed),
    };
  }

  function setSelectedModel(value: string) {
    selectedModel = value;
    testedModelKey = '';
    feedback = null;
    const profile = activeProfile;
    if (!profile) return;
    const next = { ...profile, selectedModel: value || undefined };
    settings = { ...settings, ollamaProfiles: settings.ollamaProfiles.map((item) => item.id === next.id ? next : item) };
    persistAssistantSettings(settings);
  }

  function contextLabel() {
    if (contextChoice === 'selection') return 'selected Markdown';
    if (contextChoice === 'file') return fileName;
    return 'no document context';
  }

  function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
  }

  function numberOrUndefined(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function integerOrUndefined(value: string): number | undefined {
    const parsed = numberOrUndefined(value);
    return parsed === undefined || !Number.isInteger(parsed) ? undefined : parsed;
  }

  function friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^Error:\s*/i, '').slice(0, 600) || 'Ollama request failed.';
  }

  function formatBytes(bytes?: number): string {
    if (bytes === undefined) return 'unknown size';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MiB`;
  }

  function formatCount(value?: number): string {
    return value === undefined ? 'unknown' : value.toLocaleString();
  }
</script>

<div class="assistant-panel">
  <div class="panel-list assistant-list">
    <div class="panel-title assistant-heading"><span>Assistant</span><span class="assistant-phase">Phase 1 · feedback only</span></div>
    <p class="muted-copy">Use a configured Ollama model to review explicit Markdown context. Nothing is written to the file in this phase.</p>

    {#if loadingSettings}
      <p class="muted-copy" role="status">Loading assistant settings…</p>
    {:else if !settings.ollamaProfiles.length}
      <div class="assistant-empty"><strong>No provider configured</strong><p>Add an Ollama profile to discover models. The app makes no provider calls until you explicitly refresh or send.</p><button class="secondary-button" type="button" onclick={addProfile}>Add Ollama profile</button></div>
    {:else}
      <label class="assistant-field" for="assistant-profile">Profile<select id="assistant-profile" value={activeProfile?.id ?? ''} onchange={(event) => selectProfile(event.currentTarget.value)}>{#each settings.ollamaProfiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select></label>
      <div class="assistant-actions"><button class="secondary-button" type="button" onclick={() => (settingsOpen = !settingsOpen)}>{settingsOpen ? 'Hide settings' : 'Profile settings'}</button><button class="secondary-button" type="button" disabled={!activeProfile || busy === 'refreshing'} onclick={() => void refreshModels()}>{busy === 'refreshing' ? 'Refreshing…' : 'Refresh models'}</button></div>

      {#if settingsOpen}
        <div class="assistant-settings" aria-label="Ollama profile settings">
          <label class="assistant-field" for="assistant-profile-name">Profile name<input id="assistant-profile-name" bind:value={profileName} maxlength="128" /></label>
          <label class="assistant-field" for="assistant-endpoint">Ollama endpoint<input id="assistant-endpoint" bind:value={endpoint} inputmode="url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:11434" /><small>Enter the endpoint yourself. LAN HTTP is allowed only after you enable the confirmation below.</small></label>
          <label class="assistant-check"><input type="checkbox" bind:checked={allowPrivateNetwork} /> Allow this profile to connect to a private LAN endpoint</label>
          <div class="assistant-actions"><button class="primary-button" type="button" onclick={saveProfile}>Save profile</button><button class="secondary-button" type="button" onclick={removeProfile}>Remove profile</button></div>
        </div>
      {/if}

      {#if discovery}
        <div class="assistant-connection" role="status"><span class="status-dot"></span><span>Connected to {discovery.endpoint}</span><small>{discovery.models.length} installed · resolved {discovery.resolvedAddress}{discovery.serverVersion ? ` · server ${discovery.serverVersion}` : ''}</small></div>
      {/if}

      {#if models.length}
        <label class="assistant-field" for="assistant-model">Model<select id="assistant-model" value={selectedModel} onchange={(event) => setSelectedModel(event.currentTarget.value)}><option value="">Choose a discovered model</option>{#each models as model}<option value={model.name} disabled={model.chatSuitability === 'embeddingOnly' || model.chatSuitability === 'unsupported'}>{model.name}{model.chatSuitability === 'embeddingOnly' ? ' · embedding only' : model.chatSuitability === 'unsupported' ? ' · not chat-capable' : ''}</option>{/each}</select></label>
        {#if selectedModelDetails}
          {@const model = selectedModelDetails}
          <div class="assistant-model-card">
            <div class="assistant-model-title"><strong>{model.name}</strong><button class="text-button" type="button" onclick={() => (expandedModel = expandedModel === model.name ? '' : model.name)}>{expandedModel === model.name ? 'Hide details' : 'Details'}</button></div>
            <div class="assistant-badges">{#each model.capabilities as capability}<span class="assistant-badge">{capability}</span>{/each}<span class:assistant-badge-warn={model.chatSuitability === 'unverified'} class="assistant-badge">{model.chatSuitability === 'unverified' ? 'chat suitability unverified' : model.chatSuitability}</span></div>
            <small>{model.parameterSize ?? 'parameter size unknown'} · {model.quantization ?? 'quantization unknown'} · {formatBytes(model.size)}</small>
            {#if expandedModel === model.name}
              <dl class="assistant-model-details"><dt>Family</dt><dd>{model.family ?? 'unknown'}</dd><dt>Context length</dt><dd>{formatCount(model.contextLength)} tokens</dd><dt>Embedding length</dt><dd>{formatCount(model.embeddingLength)}</dd><dt>Required version</dt><dd>{model.requires ?? 'not reported'}</dd><dt>License</dt><dd>{model.license ?? 'not reported'}</dd><dt>Parameters</dt><dd><pre>{model.parameters ?? 'not reported'}</pre></dd></dl>
            {/if}
            {#if model.showError}<p class="assistant-warning">Details could not be refreshed: {model.showError}</p>{/if}
          </div>
          {#if model.chatSuitability === 'embeddingOnly' || model.chatSuitability === 'unsupported'}
            <p class="assistant-warning">This model is not offered for chat. Embedding and other specialized models are kept out of the feedback path.</p>
          {:else}
            <button class="secondary-button assistant-test" type="button" disabled={Boolean(busy) || !discovery} onclick={() => void testSelectedModel()}>{busy === 'testing' ? 'Testing…' : selectedModelReady ? 'Model tested' : 'Test selected model'}</button>
          {/if}
        {/if}
      {:else if discovery}
        <p class="muted-copy">No models were reported by this Ollama server.</p>
      {:else}
        <p class="muted-copy">Save the profile, then choose Refresh models. Discovery is always explicit.</p>
      {/if}

      <div class="assistant-context">
        <div class="assistant-section-label">Context</div>
        <label class="assistant-radio"><input type="radio" name="assistant-context" value="none" bind:group={contextChoice} /> No document content</label>
        <label class="assistant-radio" class:assistant-disabled={!selectedText}><input type="radio" name="assistant-context" value="selection" bind:group={contextChoice} disabled={!selectedText} /> Current selection {selectedText ? `(${byteLength(selectedText).toLocaleString()} bytes)` : '(none)'}</label>
        <label class="assistant-radio" class:assistant-disabled={!source}><input type="radio" name="assistant-context" value="file" bind:group={contextChoice} disabled={!source} /> Attach current file, bounded ({fileName})</label>
        {#if contextChoice !== 'none'}<small>Sending {contextLabel}: {selectedContextBytes.toLocaleString()} bytes. The request is refused above {(MAX_CONTEXT_BYTES / 1024).toLocaleString()} KiB.</small>{/if}
        {#if contextChoice !== 'none' && selectedContextBytes <= MAX_CONTEXT_BYTES}<details class="assistant-context-preview"><summary>Show attached context</summary><pre>{selectedContext}</pre></details>{/if}
      </div>

      <label class="assistant-field" for="assistant-prompt">Prompt<textarea id="assistant-prompt" bind:value={prompt} rows="4" maxlength="65536" placeholder="Ask for feedback, organization ideas, or a clearer structure…"></textarea></label>
      <details class="assistant-advanced"><summary>Generation settings</summary><div class="assistant-options"><label>Temperature<input type="number" min="0" max="2" step="0.05" bind:value={temperature} placeholder="model default" /></label><label>Top P<input type="number" min="0" max="1" step="0.05" bind:value={topP} placeholder="default" /></label><label>Top K<input type="number" min="1" max="4096" step="1" bind:value={topK} placeholder="default" /></label><label>Context tokens<input type="number" min="256" max="2000000" step="1" bind:value={numCtx} placeholder="model default" /></label><label>Output tokens<input type="number" min="-1" max="1000000" step="1" bind:value={numPredict} placeholder="model default" /></label><label>Seed<input type="number" step="1" bind:value={seed} placeholder="random" /></label></div>{#if selectedModelDetails?.capabilities.includes('thinking')}<label class="assistant-check"><input type="checkbox" bind:checked={think} /> Request model thinking output (when supported)</label>{/if}</details>
      <button class="primary-button assistant-send" type="button" disabled={!canSend} onclick={() => void sendFeedback()}>{busy === 'sending' ? 'Waiting for feedback…' : 'Send read-only feedback'}</button>
      {#if !selectedModelReady && selectedModel && selectedModelDetails?.chatSuitability === 'unverified'}<p class="assistant-warning">Run the explicit model smoke test before sending feedback.</p>{/if}
      {#if selectedContextBytes > MAX_CONTEXT_BYTES}<p class="assistant-warning">This context is too large for the bounded Phase 1 request. Select a smaller range.</p>{/if}
    {/if}

    {#if errorMessage}<p class="assistant-error" role="alert">{errorMessage}</p>{/if}
    {#if feedback}
      <div class="assistant-response"><div class="assistant-section-label">Read-only feedback from {feedback.model}</div><pre>{feedback.content}</pre>{#if feedback.thinking}<details><summary>Thinking output</summary><pre>{feedback.thinking}</pre></details>{/if}<small>{feedback.promptEvalCount ? `${feedback.promptEvalCount.toLocaleString()} prompt tokens` : ''}{feedback.evalCount ? ` · ${feedback.evalCount.toLocaleString()} output tokens` : ''}</small></div>
    {/if}

    <p class="assistant-privacy">Ollama receives only the prompt and context you explicitly attach. This Phase 1 panel has no file tools, shell access, MCP, automatic workspace reading, or document write path.</p>
  </div>
</div>
