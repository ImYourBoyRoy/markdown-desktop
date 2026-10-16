// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DocumentLoading from './DocumentLoading.svelte';
import { openingDocumentLoading, renderingDocumentLoading } from '../lib/document-loading';

describe('DocumentLoading', () => {
  it('announces the opening phase without pretending to know progress', () => {
    render(DocumentLoading, { props: { loading: openingDocumentLoading(1) } });

    expect(screen.getByRole('status').textContent).toContain('OPENING MARKDOWN');
    expect(screen.getByRole('status').textContent).toContain('Reading the Markdown source');
    expect(screen.queryByText(/source mapping stays active/)).toBeNull();
  });

  it('shows the rendering phase and source size after native work completes', () => {
    render(DocumentLoading, {
      props: { loading: renderingDocumentLoading(2, 'doc-1', 'README', 12_345) },
    });

    expect(screen.getByRole('status').textContent).toContain('PREPARING PREVIEW');
    expect(screen.getByRole('status').textContent).toContain('Preparing README');
    expect(screen.getByRole('status').textContent).toContain('12 KB source');
  });
});
