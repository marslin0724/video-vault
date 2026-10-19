import { test as base, devices, webkit } from '@playwright/test';

/**
 * WebKit (like Safari private browsing) has no OPFS in an ephemeral context, so the iPhone project
 * runs each test in a fresh persistent profile instead of the default incognito-style context.
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    if (testInfo.project.name !== 'iphone-webkit') return use(context);
    const ctx = await webkit.launchPersistentContext(testInfo.outputPath('profile'), {
      ...devices['iPhone 14'],
      baseURL: testInfo.project.use.baseURL,
    });
    await use(ctx);
    await ctx.close();
  },
});
export { expect } from '@playwright/test';
