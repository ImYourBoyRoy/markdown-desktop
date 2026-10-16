#!/usr/bin/env node
/** Real-browser proof that inert HTML cannot request disabled remote media. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  await page.route('https://www.youtube-nocookie.com/**', async (route) => { requests.push(route.request().url()); await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test provider</title>' }); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/block-drag.html`);
  await page.evaluate(async () => {
    const { mount, unmount } = await import('/node_modules/.vite/deps/svelte.js');
    const { default: MarkdownView } = await import('/src/components/MarkdownView.svelte');
    window.mountMediaFixture = async (allowed, belowViewport = false) => {
      if (window.mediaFixture) await unmount(window.mediaFixture);
      document.body.replaceChildren();
      const target = document.createElement('main'); document.body.append(target);
      const source = 'Embedded video';
      window.mediaFixture = mount(MarkdownView, { target, props: {
        html: `${belowViewport ? '<div style="height:3000px">Spacer</div>' : ''}<iframe src="https://www.youtube-nocookie.com/embed/abcdefghi" title="Test video"></iframe>`,
        source, renderedSource: source, sourceMap: { version: 1, sourceHash: 'sha256:privacy-fixture', spans: [] }, allowRemoteImages: allowed,
      } });
    };
    await window.mountMediaFixture(false);
  });
  await page.waitForFunction(() => document.querySelector('iframe[data-media-error]'));
  assert.deepEqual(requests, [], 'disabled embeds must make zero requests, including during initial HTML mounting');
  await page.evaluate(() => window.mountMediaFixture(true, true));
  await page.waitForFunction(() => document.querySelector('iframe[data-media-src]'));
  assert.deepEqual(requests, [], 'enabled embeds stay inert outside the lazy viewport');
  await page.locator('iframe').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('iframe')?.getAttribute('src')?.startsWith('https://'));
  await page.locator('.media-preview-trigger').waitFor();
  assert.equal(requests.length, 1, 'an allowed visible embed loads once');
  await page.evaluate(() => window.mountMediaFixture(false));
  await page.waitForFunction(() => document.querySelector('iframe[data-media-error]'));
  assert.equal(requests.length, 1, 'disabling again must unload and stop new provider requests');
  console.log('Remote media privacy: 4 browser assertions passed');
} finally { await browser?.close(); await server.close(); }
