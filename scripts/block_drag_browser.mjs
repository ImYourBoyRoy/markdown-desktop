#!/usr/bin/env node
// ./scripts/block_drag_browser.mjs
/** Exercise the rendered block grip with real Chromium mouse input. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(projectRoot);

const server = await createServer({
  configFile: resolve(projectRoot, 'vite.config.ts'),
  root: projectRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
});
let browser;

try {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== 'string', 'Vite did not expose a local test server');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/block-drag.html`);

  const handles = page.locator('.block-drag-handle');
  await handles.nth(1).waitFor({ state: 'visible' });
  const grip = await handles.first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      cursor: getComputedStyle(element).cursor,
      hitIsGrip: hit === element,
      editable: element.isContentEditable,
      mappedAsMarkdown: element.hasAttribute('data-map-id') || element.hasAttribute('data-map-kind'),
    };
  });
  assert.equal(grip.cursor, 'grab', 'the grip should advertise a grab cursor');
  assert.equal(grip.hitIsGrip, true, 'the six-dot grip should own its visible hit target');
  assert.equal(grip.editable, false, 'the grip must not become a contenteditable Markdown node');
  assert.equal(grip.mappedAsMarkdown, false, 'the grip must not enter the source-map DOM');

  const sourceRect = await page.locator('h1[data-map-id="first"]').boundingBox();
  const target = page.locator('h1[data-map-id="second"]');
  assert.ok(sourceRect, 'the source block must be visible');
  const targetRect = await target.boundingBox();
  assert.ok(targetRect, 'the destination block must be visible');
  const dropPoint = {
    x: targetRect.x + targetRect.width / 2,
    y: targetRect.y + targetRect.height * 0.75,
  };
  await page.mouse.move(grip.center.x, grip.center.y);
  await page.mouse.down();
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('h1[data-map-id="second"]')
    ?.classList.contains('block-drop-after'));

  const preview = page.locator('[data-block-drag-preview]');
  await preview.waitFor({ state: 'visible' });
  const visual = await preview.evaluate((element) => {
    const style = getComputedStyle(element);
    const transform = new DOMMatrixReadOnly(style.transform);
    return {
      position: style.position,
      pointerEvents: style.pointerEvents,
      boxShadow: style.boxShadow,
      x: transform.m41,
      y: transform.m42,
      scale: transform.a,
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.inert,
      hasPlaceholder: document.querySelector('h1[data-map-id="first"]')
        ?.classList.contains('block-dragging') ?? false,
      mappedClones: element.querySelectorAll('[data-map-id], [data-map-kind]').length,
    };
  });
  assert.equal(visual.position, 'fixed', 'the lifted block should follow viewport pointer coordinates');
  assert.equal(visual.pointerEvents, 'none', 'the preview must not intercept drop hit-testing');
  assert.notEqual(visual.boxShadow, 'none', 'the lifted preview should read as elevated');
  assert.ok(visual.scale > 1, 'the lifted preview should enlarge subtly while grabbed');
  assert.equal(visual.ariaHidden, 'true', 'the duplicate preview must stay out of the accessibility tree');
  assert.equal(visual.inert, true, 'the duplicate preview must not be focusable or interactive');
  assert.equal(visual.hasPlaceholder, true, 'the original block should remain as a drop placeholder');
  assert.equal(visual.mappedClones, 0, 'the preview must not duplicate source-map identities');
  assert.ok(
    Math.abs(visual.x - (dropPoint.x - (grip.center.x - sourceRect.x))) < 2
      && Math.abs(visual.y - (dropPoint.y - (grip.center.y - sourceRect.y))) < 2,
    'the lifted preview should preserve the grab point and track the held pointer',
  );
  await page.mouse.up();
  assert.equal(await preview.count(), 0, 'the lifted preview should disappear immediately on release');

  const result = await page.evaluate(() => window.blockDragResult);
  assert.deepEqual(result, {
    movingMapId: 'first',
    targetMapId: 'second',
    position: 'after',
    source: '# Second\n\n# First',
  }, 'a real mouse drag should reorder the rendered block through the source transaction');

  console.log('PASS rendered grip hit target and grab cursor');
  console.log('PASS lifted preview tracks the pointer and cleans up on release');
  console.log('PASS real Chromium mouse drag reorders the mapped Markdown source');
} finally {
  await browser?.close();
  await server.close();
}
