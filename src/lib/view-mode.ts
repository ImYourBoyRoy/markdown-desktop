import type { ViewMode } from './types';

export type StartupViewPreference = 'remember' | ViewMode;

export interface InitialViewState {
  mode: ViewMode;
  sourceVisible: boolean;
  sourceEditorMounted: boolean;
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'rendered' || value === 'source' || value === 'split';
}

export function normalizeStartupViewPreference(value: string | null): StartupViewPreference {
  return value === 'remember' || isViewMode(value) ? value : 'remember';
}

/**
 * Resolve the launch layout independently from the layout switcher used during
 * a session. A fixed Rendered preference also overrides a remembered open
 * source drawer, while Remember restores the complete prior pane arrangement.
 */
export function initialViewStateForPreference(
  preference: StartupViewPreference,
  lastUsedMode: string | null,
  rememberedSourceVisible: boolean,
): InitialViewState {
  const mode = preference === 'remember'
    ? isViewMode(lastUsedMode) ? lastUsedMode : 'rendered'
    : preference;
  const sourceVisible = preference === 'rendered' ? false : rememberedSourceVisible;
  return {
    mode,
    sourceVisible,
    sourceEditorMounted: mode !== 'rendered' || sourceVisible,
  };
}

/**
 * The source drawer is independently collapsible while editing in Render.
 * Source and Split modes always keep the source pane visible.
 */
export function sourceViewVisibleForState(
  mode: ViewMode,
  editing: boolean,
  sourceVisible: boolean,
): boolean {
  return mode !== 'rendered' || (editing && sourceVisible);
}

/** Report the view the user can actually see, not only the persisted default. */
export function effectiveViewModeForState(
  mode: ViewMode,
  editing: boolean,
  sourceVisible: boolean,
): ViewMode {
  return mode === 'rendered' && sourceViewVisibleForState(mode, editing, sourceVisible)
    ? 'split'
    : mode;
}
