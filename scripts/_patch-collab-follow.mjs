#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/snapshot-journeys.mjs';
let content = readFileSync(path, 'utf8');
let changes = 0;

function replace(old, nw, label) {
  if (!content.includes(old)) {
    console.error(`MISS: "${label}" — old string not found`);
    return;
  }
  content = content.replace(old, nw);
  changes++;
  console.log(`OK: ${label}`);
}

// After bob-sees-alice-content, add presence verification + follow steps
replace(
  `        await step.dual(pageB, chromium, 'alice-continues-typing', 'Alice adds more content while Bob watches', async () => {`,

  `        // --- Presence & follow ---
        await step.dual(pageB, chromium, 'check-presence-indicators', 'Both browsers show presence avatars in the header', async () => {
          // Wait for presence to sync between the two browser contexts
          await page.waitForTimeout(1_000);
          await pageB.waitForTimeout(500);
          // Scroll to top on both to see the header with avatars
          await page.evaluate(() => window.scrollTo({ top: 0 }));
          await pageB.evaluate(() => window.scrollTo({ top: 0 }));
          await page.waitForTimeout(300);
        });

        await step.dual(pageB, chromium, 'bob-hovers-alice-avatar', 'Bob hovers over Alice\\'s avatar to see the tooltip with Follow button', async () => {
          const avatars = await pageB.$('[data-testid="participant-avatars"]');
          if (avatars) {
            const items = await avatars.$$('div[style*="cursor"]');
            if (items.length > 0) {
              await items[0].hover();
              await pageB.waitForTimeout(600);
            }
          }
        });

        await step.dual(pageB, chromium, 'bob-clicks-follow', 'Bob clicks "Follow" to track Alice\\'s cursor and scroll position', async () => {
          const followBtn = await pageB.$('div[role="button"]:has-text("Follow")');
          if (followBtn) {
            await followBtn.click();
            await pageB.waitForTimeout(600);
          }
        });

        await step.dual(pageB, chromium, 'alice-continues-typing', 'Alice adds more content while Bob watches', async () => {`,
  'J4: add presence and follow steps'
);

// After both-typing-simultaneously, add a step showing the "following" indicator
replace(
  `        await step.dual(pageB, chromium, 'alice-sees-bob-notes', 'Alice scrolls down to see what Bob wrote in notes', async () => {`,

  `        await step.dual(pageB, chromium, 'see-follow-tracking', 'Bob\\'s view auto-scrolls to follow Alice — "following" badge visible in header', async () => {
          // Alice scrolls to top, Bob should follow
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await page.waitForTimeout(800);
        });

        await step.dual(pageB, chromium, 'alice-sees-bob-notes', 'Alice scrolls down to see what Bob wrote in notes', async () => {`,
  'J4: add follow tracking step'
);

writeFileSync(path, content, 'utf8');
console.log(`\nDone — ${changes} replacements applied. Lines: ${content.split('\n').length}`);
