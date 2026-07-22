const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, 'user_data');

async function runDiagnostics() {
  console.log('=== Testing Strict Hiring Boolean Query with correct Sort Parameter ===');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  try {
    const keywords = '("hiring" OR "looking for" OR "seeking" OR "need") AND "freelance" AND ("website" OR "wordpress" OR "shopify" OR "web developer" OR "landing page")';
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywords)}&sortBy=%22date_posted%22&datePosted=%22past-24h%22`;
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    const count = await page.locator('div[role="listitem"]').count();
    console.log(`-> Count: ${count}`);

    for (let i = 0; i < count; i++) {
      const text = await page.locator('div[role="listitem"]').nth(i).evaluate(el => el.innerText.trim().substring(0, 150));
      console.log(`\nCard ${i} text:\n${text}\n----------------------`);
    }

  } catch (err) {
    console.error('Diagnostics failed:', err);
  } finally {
    await context.close();
  }
}

runDiagnostics();
