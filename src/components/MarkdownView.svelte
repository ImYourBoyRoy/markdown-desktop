<script lang="ts">
  import DOMPurify from 'dompurify';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount, tick } from 'svelte';
  import { fetchRemoteAsset, resolveAsset } from '../lib/ipc';

  export let html = '';
  export let documentId = '';
  export let headingSlugs: string[] = [];
  export let allowRemoteImages = true;
  export let onOpenLink: (target: string) => void = () => undefined;

  let host: HTMLElement;
  let rendered = '';
  let renderVersion = 0;
  let observers: IntersectionObserver[] = [];

  $: if (html) {
    rendered = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
    renderVersion += 1;
    void tick().then(() => enhance(allowRemoteImages, renderVersion));
  }

  onMount(() => {
    void enhance(allowRemoteImages, renderVersion);
    return () => teardown();
  });

  function teardown() {
    observers.forEach((observer) => observer.disconnect());
    observers = [];
  }

  async function enhance(remoteImagesAllowed: boolean, version: number) {
    if (!host || version !== renderVersion) return;
    teardown();
    host.innerHTML = rendered;
    await tick();
    if (version !== renderVersion) return;
    const thisVersion = version;
    host.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
      const slug = headingSlugs[index];
      if (slug) heading.id = slug;
    });
    host.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      anchor.addEventListener('click', async (event) => {
        const target = anchor.getAttribute('href') ?? '';
        if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
          event.preventDefault();
          await openUrl(target);
        } else if (!target.startsWith('#')) {
          event.preventDefault();
          onOpenLink(target);
        }
      });
    });

    host.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
      const target = image.getAttribute('src') ?? '';
      image.dataset.source = target;
      image.src = tinyPlaceholder();
      image.setAttribute('aria-busy', 'true');
      const load = async () => {
        try {
          if (/^https?:\/\//i.test(target) && !remoteImagesAllowed) {
            throw new Error('Remote images are disabled in Settings');
          }
          const asset = /^https?:\/\//i.test(target)
            ? await fetchRemoteAsset(target)
            : await resolveAsset(documentId, decodeURIComponent(target));
          if (thisVersion !== renderVersion) return;
          image.src = asset.dataUri;
          image.removeAttribute('aria-busy');
        } catch (error) {
          image.removeAttribute('aria-busy');
          image.classList.add('asset-error');
          image.alt = `${image.alt || 'Image'} — unavailable`;
          image.title = String(error);
        }
      };
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            void load();
          }
        }, { rootMargin: '240px' });
        observers.push(observer);
        observer.observe(image);
      } else {
        void load();
      }
    });

    host.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code || pre.querySelector('.copy-code')) return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.type = 'button';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy code block');
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1200);
      });
      pre.append(button);
    });

    const diagrams = [...host.querySelectorAll<HTMLPreElement>('pre')].filter((pre) => {
      const code = pre.querySelector('code');
      return Boolean(code?.className.match(/language-(mermaid|dot|graphviz)/i));
    });
    diagrams.forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code || pre.dataset.diagramReady) return;
      pre.dataset.diagramReady = 'pending';
      const render = () => {
        pre.dataset.diagramReady = 'ready';
        void renderDiagram(pre, code.textContent ?? '', code.className);
      };
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            render();
          }
        }, { rootMargin: '400px' });
        observers.push(observer);
        observer.observe(pre);
      } else render();
    });

    if (host.textContent?.includes('$')) {
      try {
        const { default: renderMathInElement } = await import('katex/contrib/auto-render');
        renderMathInElement(host, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
      } catch {
        // Math remains source text if the optional renderer cannot be loaded.
      }
    }
  }

  async function renderDiagram(pre: HTMLPreElement, source: string, className: string) {
    const language = className.match(/language-(mermaid|dot|graphviz)/i)?.[1].toLowerCase();
    const output = document.createElement('div');
    output.className = 'diagram-output';
    try {
      if (language === 'mermaid') {
        const module = await import('mermaid');
        const mermaid = module.default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base' });
        const result = await mermaid.render(`diagram-${Date.now()}-${Math.random().toString(16).slice(2)}`, source);
        output.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: false } });
      } else {
        const { instance } = await import('@viz-js/viz');
        const viz = await instance();
        const svg = viz.renderString(source, { format: 'svg' });
        output.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: false } });
      }
      pre.replaceWith(output);
    } catch (error) {
      output.className += ' diagram-error';
      output.textContent = `Diagram could not be rendered: ${String(error)}`;
      pre.replaceWith(output);
    }
  }

  function tinyPlaceholder() {
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="20"%3E%3Crect width="32" height="20" fill="%23dfe7f2"/%3E%3C/svg%3E';
  }
</script>

<article class="markdown-view" bind:this={host} aria-label="Rendered Markdown"></article>

<style>
  .markdown-view { max-width: var(--document-width); margin: 0 auto; padding: 42px clamp(24px, 5vw, 78px) 120px; color: var(--text); }
  :global(.markdown-view h1), :global(.markdown-view h2), :global(.markdown-view h3), :global(.markdown-view h4) { color: var(--heading); letter-spacing: -0.025em; scroll-margin-top: 24px; }
  :global(.markdown-view h1) { font-size: clamp(30px, 4vw, 46px); line-height: 1.1; margin: 0 0 24px; }
  :global(.markdown-view h2) { font-size: 28px; margin: 42px 0 14px; }
  :global(.markdown-view h3) { font-size: 21px; margin: 32px 0 12px; }
  :global(.markdown-view p), :global(.markdown-view li) { font-size: 15px; line-height: 1.75; }
  :global(.markdown-view p) { margin: 0 0 18px; }
  :global(.markdown-view a) { color: var(--link); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--link) 35%, transparent); }
  :global(.markdown-view a:hover) { border-bottom-color: var(--link); }
  :global(.markdown-view blockquote) { margin: 24px 0; padding: 8px 18px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--panel) 75%, var(--accent) 25%); border-radius: 0 10px 10px 0; }
  :global(.markdown-view pre) { position: relative; overflow: auto; padding: 18px; margin: 22px 0; border: 1px solid var(--border); border-radius: 12px; background: var(--code-bg); }
  :global(.markdown-view code) { font: 0.9em/1.6 var(--font-mono); }
  :global(.markdown-view :not(pre) > code) { padding: 2px 5px; border-radius: 5px; background: var(--code-bg); color: var(--accent-strong); }
  :global(.markdown-view table) { border-collapse: collapse; width: 100%; margin: 24px 0; }
  :global(.markdown-view th), :global(.markdown-view td) { border: 1px solid var(--border); padding: 9px 12px; text-align: left; }
  :global(.markdown-view th) { background: var(--panel); color: var(--heading); }
  :global(.markdown-view img) { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--border); background: var(--panel); }
  :global(.markdown-view img.asset-error) { min-height: 46px; opacity: 0.6; }
  :global(.markdown-view hr) { border: 0; border-top: 1px solid var(--border); margin: 36px 0; }
  :global(.copy-code) { position: absolute; top: 8px; right: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--muted); padding: 4px 8px; font-size: 11px; cursor: pointer; }
  :global(.diagram-output) { margin: 22px 0; padding: 18px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--code-bg); }
  :global(.diagram-output svg) { max-width: 100%; height: auto; }
  :global(.diagram-error) { color: var(--danger); font-family: var(--font-mono); white-space: pre-wrap; }
</style>
