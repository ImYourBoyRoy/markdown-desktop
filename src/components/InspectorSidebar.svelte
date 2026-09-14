<script lang="ts">
  import type { CompatibilityTarget, Issue, LinkInfo, OpenedDocument } from '../lib/types';

  export type InspectorPanel = 'outline' | 'links' | 'backlinks' | 'issues' | 'properties';
  type VoidAction = () => void;

  let {
    panel = 'outline',
    active,
    activeHeadingSlug,
    issues,
    issueFilter,
    compatibilityTarget,
    compatibilityIssueCount,
    onPanelChange,
    onTablistKeydown,
    onCollapse,
    onHeading,
    onLink,
    onIssue,
    onLearnMore,
    onOpenLink,
    onIssueFilterChange,
  } = $props<{
    panel?: InspectorPanel;
    active: OpenedDocument | null;
    activeHeadingSlug?: string;
    issues: Issue[];
    issueFilter: 'all' | 'compatibility';
    compatibilityTarget: CompatibilityTarget;
    compatibilityIssueCount: number;
    onPanelChange: (panel: InspectorPanel) => void;
    onTablistKeydown: (event: KeyboardEvent) => void;
    onCollapse: VoidAction;
    onHeading: (slug: string) => void;
    onLink: (link: LinkInfo) => void;
    onOpenLink: (target: string) => void;
    onIssue: (issue: Issue) => void;
    onLearnMore: (url: string) => void;
    onIssueFilterChange: (filter: 'all' | 'compatibility') => void;
  }>();

  const panels: [InspectorPanel, string][] = [
    ['outline', 'Outline'],
    ['links', 'Links'],
    ['backlinks', 'Backlinks'],
    ['issues', 'Issues'],
    ['properties', 'Props'],
  ];
</script>

<aside class="right-sidebar" aria-label="Document intelligence">
  <div class="right-tabs">
    <button class="collapse-button panel-collapse-control" type="button" aria-label="Collapse right sidebar" aria-expanded="true" onclick={onCollapse}>›</button>
    <div class="right-panel-tabs" role="tablist" aria-label="Document panels">
      {#each panels as [value, label]}
        <button id={'right-' + value + '-tab'} class:active={panel === value} type="button" role="tab" aria-selected={panel === value} aria-controls={panel === value && active ? 'right-' + value + '-panel' : undefined} tabindex={panel === value ? 0 : -1} onclick={() => onPanelChange(value)} onkeydown={onTablistKeydown}>{label}</button>
      {/each}
    </div>
  </div>
  {#if active}
    <div id={'right-' + panel + '-panel'} role="tabpanel" aria-labelledby={'right-' + panel + '-tab'} tabindex="0">
      {#if panel === 'outline'}
        <div class="panel-list"><div class="panel-title">Document outline</div>{#each active.headings as heading (heading.slug)}<button class={'outline-row depth-' + heading.level} type="button" aria-current={activeHeadingSlug === heading.slug ? 'location' : undefined} onclick={() => onHeading(heading.slug)}><span>{heading.level}</span>{heading.text}</button>{/each}{#if !active.headings.length}<p class="muted-copy">No headings in this document.</p>{/if}</div>
      {:else if panel === 'links'}
        <div class="panel-list"><div class="panel-title">Links in this document <span>{active.links.length}</span></div>{#each active.links as link}<div class="link-entry"><button class="info-row" type="button" title="Select this link in the rendered preview and source" onclick={() => onLink(link)}><span class="status-dot" class:external={link.kind === 'external'}></span><span><strong>{link.label || link.target}</strong><small>{link.target}</small></span></button><button class="link-open-button" type="button" title="Open link" aria-label={`Open ${link.label || link.target}`} onclick={() => onOpenLink(link.target)}>↗</button></div>{/each}{#if !active.links.length}<p class="muted-copy">No links found.</p>{/if}</div>
      {:else if panel === 'backlinks'}
        <div class="panel-list"><div class="panel-title">Backlinks</div><p class="muted-copy">Backlinks are not indexed in this version. Use workspace search from the left sidebar.</p></div>
      {:else if panel === 'issues'}
        <div class="panel-list"><div class="panel-title"><span>Issues</span><span>{issues.length}</span></div><div class="issue-filters" role="group" aria-label="Issue scope"><button class:active={issueFilter === 'all'} type="button" onclick={() => onIssueFilterChange('all')}>All</button><button class:active={issueFilter === 'compatibility'} type="button" disabled={compatibilityTarget === 'none'} onclick={() => onIssueFilterChange('compatibility')}>GitHub README <span>{compatibilityIssueCount}</span></button></div>{#each issues as issue (issue.mapId ?? issue.code ?? issue.title)}<div class="issue-entry"><button class="issue-row" type="button" title={issue.mapId ? 'Select this issue in the source editor' : issue.detail} onclick={() => onIssue(issue)}><span class:issue-error={issue.severity === 'error'} class:issue-warning={issue.severity === 'warning'} class:issue-info={issue.severity === 'info'} class="issue-icon" aria-hidden="true">{issue.severity === 'error' ? '!' : issue.severity === 'info' ? 'i' : '△'}</span><span><strong>{issue.title}</strong><small>{issue.detail}</small><small class="issue-meta">{issue.severity}{issue.code ? ' · ' + issue.code : ''}</small></span></button>{#if issue.learnMore}<button class="issue-learn-more" type="button" onclick={(event) => { event.stopPropagation(); onLearnMore(issue.learnMore!); }}>Learn more</button>{/if}</div>{/each}{#if !issues.length}<p class="muted-copy success-copy">{issueFilter === 'compatibility' ? '✓ No GitHub README advisories for this document.' : '✓ No issues detected.'}</p>{/if}</div>
      {:else}
        <div class="panel-list properties"><div class="panel-title">Properties</div><dl><dt>File</dt><dd>{active.meta.fileName}</dd><dt>Location</dt><dd title={active.meta.path}>{active.meta.path}</dd><dt>Size</dt><dd>{Math.max(1, Math.round(active.meta.bytes / 1024))} KB</dd><dt>Encoding</dt><dd>{active.meta.encoding}</dd><dt>Line endings</dt><dd>{active.meta.lineEnding}</dd><dt>Profile</dt><dd>{active.meta.profile}</dd></dl></div>
      {/if}
    </div>
  {:else}
    <div class="empty-sidebar"><span class="empty-symbol">⌁</span><p>Open a document to see its outline, links, issues, and properties.</p></div>
  {/if}
</aside>
