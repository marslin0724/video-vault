import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
    },
    {
      // Same engine as Safari with iPhone viewport/UA/touch. Not a real iOS device: storage quota,
      // background throttling and HEVC playback cannot be checked here.
      name: 'iphone-webkit',
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
