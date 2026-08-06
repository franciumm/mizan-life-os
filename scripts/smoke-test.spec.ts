import { test, expect } from '@playwright/test';

test.describe('Mizan Core Daily Loop (Smoke Test)', () => {
  test('User can load app, change modes, plan tomorrow, and chat with Coach', async ({ page }) => {
    test.setTimeout(60000);
    
    // Mock API responses to avoid unpredictable LLM latency
    await page.route('/api/arrange', async route => {
      await route.fulfill({
        json: {
          plan: {
            tasks: [
              { title: 'Smoke test task 1', category: 'Business', range: 'Morning', minutes: 90, kind: 'mission' },
              { title: 'Smoke test task 2', category: 'Health', range: 'Afternoon', minutes: 60, kind: 'support' }
            ],
            overallReasoning: 'Mocked plan for fast testing.'
          }
        }
      });
    });

    await page.route('/api/coach', async route => {
      await route.fulfill({
        json: {
          reply: 'I am here. Let’s get to work.',
          actions: []
        }
      });
    });

    // 1. Load the app
    await page.goto('http://localhost:3000');
    await expect(page.locator('text=Mizan').first()).toBeVisible();
    // Give hydration a moment to finish setting mode from localStorage
    await page.waitForTimeout(1000);

    // 2. Change day mode (Grinding, Recovery, Vacation)
    const recoveryButton = page.locator('.mode-switch button:has-text("Recovery")');
    await recoveryButton.click();
    await expect(recoveryButton).toHaveClass(/selected/);
    
    const grindingButton = page.locator('.mode-switch button:has-text("Grinding")');
    await grindingButton.click();
    await expect(grindingButton).toHaveClass(/selected/);

    // 3. Trigger "I'm stuck" (if present and not already done)
    const stuckButton = page.locator('button:has-text("I’m stuck")');
    if (await stuckButton.isVisible()) {
      await stuckButton.click();
      // Should show modal
      await expect(page.locator('.stuck-response')).toBeVisible();
      await page.locator('button[aria-label="Dismiss"]').click();
    }

    // 4. Plan tomorrow
    const planButton = page.locator('button.plan-button');
    await planButton.click();
    
    const plannerSheet = page.locator('.planner-sheet');
    await expect(plannerSheet).toBeVisible();

    const brainDumpInput = plannerSheet.locator('textarea');
    await brainDumpInput.fill('Smoke test task 1, smoke test task 2');

    const arrangeButton = plannerSheet.locator('button:has-text("Arrange tomorrow")');
    await arrangeButton.click();

    // Wait for the AI/fallback to arrange tasks
    await expect(plannerSheet.locator('.draft-plan')).toBeVisible({ timeout: 30000 });
    
    // Approve plan
    const approveButton = plannerSheet.locator('button:has-text("Approve this plan")');
    await approveButton.click();

    // Review success notice
    await expect(page.locator('.toast')).toContainText('arranged', { ignoreCase: true });

    // Close the planner modal
    await plannerSheet.locator('button[aria-label="Close"]').click();
    await expect(plannerSheet).not.toBeVisible();

    // 5. Navigate to Coach
    const coachNav = page.locator('.nav-item:has-text("Coach")');
    await coachNav.click();

    await expect(page.locator('h1:has-text("Mizan Coach")')).toBeVisible();

    // 6. Send message to Coach
    const composerInput = page.locator('.composer textarea');
    await composerInput.fill('This is a smoke test message.');
    
    const sendButton = page.locator('.send-button');
    await sendButton.click();

    // Verify it appears as a user message
    const userMessage = page.locator('.message.user:has-text("This is a smoke test message.")');
    await expect(userMessage).toBeVisible();

    // Wait for Coach response (mocked or real, we just wait for a .coach message)
    // There might already be a system coach message, so we just check the list grows or pending disappears.
    await expect(page.locator('.message-pending')).not.toBeVisible({ timeout: 15000 });
    
    // Verify voice button is interruptible and not permanently stuck
    const voiceButton = page.locator('.composer-tool:has(svg)');
    await expect(voiceButton).toBeEnabled();
  });
});
