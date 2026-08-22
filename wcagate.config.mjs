const settingsContrastSuppression = {
  outcomes: ['cantTell'],
  adapter: 'frontend-browser-mode',
  justification: 'Axe reports an elmPartiallyObscuring incomplete over the modal frost backdrop. Browser contrast sampling found solid panel backgrounds with 7.17:1 dark-theme and 6.36:1 light-theme ratios for the settings copy; retain the visual treatment and reverify before expiry.',
  owner: 'Markdown Desktop maintainers',
  ticket: 'A11Y-WCAGATE-SETTINGS-CONTRAST-2026-08',
  createdAt: '2026-08-21T00:00:00.000Z',
  expiresAt: '2026-11-21T00:00:00.000Z',
};

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
  suppressions: [
    { ...settingsContrastSuppression, fingerprint: 'ce9adbe26c56b009a94e086a' },
    { ...settingsContrastSuppression, fingerprint: '79cc3ab72ec2f31bf0fcb7e1' },
    { ...settingsContrastSuppression, fingerprint: '5c9d29c17d25a829c342b813' },
    { ...settingsContrastSuppression, fingerprint: 'f2e7c69180c7089e818cb1a0' },
  ],
};
