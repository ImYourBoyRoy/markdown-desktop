export default {
  schemaVersion: 1,
  project: {
    name: 'markdown-desktop',
    root: '.',
  },
  profile: 'wcag22-aa',
  outputDirectory: 'wcag-audit',
  adapters: [
    {
      id: 'frontend-browser-mode',
      type: 'playwright-axe',
      // Vite binds host:false → localhost (::1). Prefer localhost over 127.0.0.1.
      baseURL: 'http://localhost:1420',
      browser: 'chromium',
      scenarios: [
        { name: 'opened-document', path: '/scripts/fixtures/app-review.html', steps: [{ action: 'expectVisible', selector: '.markdown-view p:first-of-type' }, { action: 'waitForTimeout', milliseconds: 300 }] },
        {
          name: 'source-editor', path: '/scripts/fixtures/app-review.html',
          setup: async (page) => {
            if (await page.getByRole('button', { name: 'Switch to visual editing' }).count()) await page.getByRole('button', { name: 'Switch to visual editing' }).click();
            await page.getByRole('button', { name: 'Show source', exact: true }).click();
            await page.locator('.cm-content').waitFor();
          }, steps: [{ action: 'waitForTimeout', milliseconds: 300 }],
        },
        { name: 'recovery-dialog', path: '/scripts/fixtures/app-review.html?recovery=1', steps: [{ action: 'expectVisible', selector: '.recovery-modal' }] },
        {
          name: 'shutdown-dialog', path: '/scripts/fixtures/app-review.html',
          setup: async (page) => {
            if (await page.getByRole('button', { name: 'Switch to visual editing' }).count()) await page.getByRole('button', { name: 'Switch to visual editing' }).click();
            const paragraph = page.locator('.markdown-view p[data-visual-editable="true"]').first();
            await paragraph.fill('Unsaved accessibility fixture.');
            await page.locator('.document-header h1').click();
            await page.evaluate(() => window.reviewFixture.emit('shutdown-request'));
            await page.locator('#shutdown-dialog').waitFor();
          }, steps: [],
        },
        { name: 'welcome', path: '/', steps: [] },
        {
          name: 'welcome-light-theme',
          path: '/',
          setup: async (page) => page.evaluate(() => {
            document.documentElement.dataset.theme = 'light';
          }),
          steps: [],
        },
        {
          name: 'command-palette',
          path: '/',
          steps: [
            { action: 'click', selector: '.command-trigger' },
            { action: 'expectVisible', selector: '.palette' },
          ],
        },
        {
          name: 'settings-light-theme',
          path: '/',
          setup: async (page) => page.evaluate(() => {
            document.documentElement.dataset.theme = 'light';
          }),
          steps: [
            { action: 'click', selector: '[aria-label="Open settings"]' },
            { action: 'expectVisible', selector: '.settings-modal' },
          ],
        },
        {
          name: 'settings-dark-theme',
          path: '/',
          steps: [
            { action: 'click', selector: '[aria-label="Open settings"]' },
            { action: 'expectVisible', selector: '.settings-modal' },
          ],
        },
        {
          name: 'compact-window',
          path: '/',
          steps: [
            { action: 'setViewport', width: 900, height: 600 },
          ],
        },
      ],
      runOnly: ['wcag2a', 'wcag21a', 'wcag22a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
      probes: {
        targetSizeEnhanced: { enabled: false, minimum: 44 },
        focusIndicatorReview: { enabled: true, maxTabs: 80 },
      },
    },
  ],
  gate: {
    failOnSeverities: ['critical', 'serious', 'moderate', 'minor'],
    failOnOutcomes: ['failed'],
    unresolvedOutcomes: ['cantTell', 'untested'],
    unresolvedEvidence: 'error',
    executionErrors: 'error',
    requireApplicableSurface: true,
  },
  reporters: [
    { type: 'console' },
    { type: 'json', file: 'latest.json' },
    { type: 'results', file: 'results.html' },
  ],
  suppressions: [],
};
