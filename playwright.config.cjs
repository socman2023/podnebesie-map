const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'tests',
  timeout: 60000,
  expect: { timeout: 20000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8765', trace: 'retain-on-failure' }
});
