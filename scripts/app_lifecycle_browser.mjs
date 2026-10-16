#!/usr/bin/env node
/** Browser UI contract tests using explicitly simulated native IPC. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
let page;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/app-review.html`;
  async function openEditing() {
    await page.goto(url); await page.locator('.markdown-view p').first().waitFor();
    if (await page.getByRole('button', { name: 'Switch to visual editing' }).count()) await page.getByRole('button', { name: 'Switch to visual editing' }).click();
    await page.locator('[data-visual-editable="true"]').first().waitFor();
  }
  async function edit(text) {
    const paragraph = page.locator('.markdown-view p[data-visual-editable="true"]').first();
    await paragraph.click(); await paragraph.fill(text); await page.locator('.document-header h1').click();
  }
  await openEditing(); await edit('Unsaved protected paragraph.');
  await page.evaluate(() => window.reviewFixture.emit('shutdown-request'));
  await page.getByRole('alertdialog', { name: 'Protect unsaved edits before quitting' }).waitFor();
  assert.equal(await page.locator('.app-shell').evaluate((shell) => shell.inert), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => window.reviewFixture.exited), false);
  await page.evaluate(() => { window.reviewFixture.failRecovery = true; window.reviewFixture.emit('shutdown-request'); });
  await page.getByRole('button', { name: 'Keep recovery and quit' }).click();
  await page.getByRole('alert').filter({ hasText: 'Simulated full disk' }).waitFor();
  assert.equal(await page.evaluate(() => window.reviewFixture.exited), false, 'failed recovery must keep the app open');
  await page.evaluate(() => { window.reviewFixture.failRecovery = false; });
  await page.getByRole('button', { name: 'Keep recovery and quit' }).click();
  await page.waitForFunction(() => window.reviewFixture.exited);
  assert.match(await page.evaluate(() => window.reviewFixture.recovery), /Unsaved protected paragraph/);
  await openEditing(); await edit('Save before quitting.');
  await page.evaluate(() => { window.reviewFixture.delaySave = 400; window.reviewFixture.emit('shutdown-request'); });
  await page.getByRole('button', { name: 'Save all and quit' }).click();
  await page.waitForFunction(() => window.reviewFixture.exited);
  assert.match(await page.evaluate(() => window.reviewFixture.saved), /Save before quitting/);
  await openEditing();
  await page.evaluate(() => { window.reviewFixture.failRender = true; });
  await edit('Retryable render paragraph.');
  await page.getByRole('button', { name: 'Retry preview' }).waitFor();
  await page.evaluate(() => { window.reviewFixture.failRender = false; });
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await page.locator('.markdown-view p').filter({ hasText: 'Retryable render paragraph' }).waitFor();
  assert.deepEqual(errors, [], 'UI lifecycle must not leave unhandled errors after teardown');
  console.log('Application lifecycle: cancel, recovery failure, recovery quit, save quit, and render retry passed (simulated IPC)');
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1000), calls: window.reviewFixture?.calls.slice(-12), paragraphs: [...document.querySelectorAll('.markdown-view p')].map((p) => p.outerHTML.slice(0, 400)) })));
  throw error;
} finally { await browser?.close(); await server.close(); }
