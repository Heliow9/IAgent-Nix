import { test, expect, _electron as electron } from '@playwright/test'

test('opens the IDE shell and a local workspace', async () => {
  test.skip(process.env.RUN_E2E !== '1', 'Set RUN_E2E=1 after npm run build to run the desktop smoke test')
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText(/construa software/i)).toBeVisible()
  await app.close()
})
