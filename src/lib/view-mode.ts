import type { ViewMode } from './types';

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
