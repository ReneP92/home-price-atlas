import { defineConfig, devices } from '@playwright/test'

// Test credentials are deliberately non-functional. All Mapbox requests are
// intercepted, and the local .env token must never enter test traces or CI.
const testToken = `pk.${Buffer.from(JSON.stringify({ u: 'local-tests', a: 'not-a-real-token' })).toString('base64url')}.not-a-real-token`
process.env.VITE_MAPBOX_ACCESS_TOKEN = testToken

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel: process.env.CI ? 'chrome' : undefined,
    launchOptions: { args: process.env.CI ? ['--enable-unsafe-swiftshader'] : [] },
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'bun run dev --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    env: { VITE_MAPBOX_ACCESS_TOKEN: testToken },
    reuseExistingServer: false,
  },
})
