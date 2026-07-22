const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, 'user_data');

async function runDiagnostics() {
  console.log('=== Analyzing Child Selectors in Post ===');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  try {
    const searchUrl = 'https://www.linkedin.com/search/results/content/?keywords=freelance%20Python&sortBy=%22date%22';
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);

    const postContainerSelector = 'div[data-view-name="feed-full-update"]';
    const postsCount = await page.locator(postContainerSelector).count();
    console.log(`Found ${postsCount} posts with "${postContainerSelector}"`);

    if (postsCount > 0) {
      // Analyze the first post's children
      const data = await page.evaluate((sel) => {
        const post = document.querySelector(sel);
        if (!post) return null;

        // Helper to get element details
        const describe = (el) => {
          if (!el) return 'null';
          let str = el.tagName.toLowerCase();
          if (el.id) str += `#${el.id}`;
          if (el.className) str += `.${Array.from(el.classList).join('.')}`;
          return str;
        };

        // Let's find links, text areas, etc.
        const links = Array.from(post.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim().substring(0, 50),
          href: a.href,
          viewName: a.getAttribute('data-view-name'),
          classes: a.className
        }));

        const buttons = Array.from(post.querySelectorAll('button')).map(b => ({
          text: b.innerText.trim(),
          classes: b.className
        }));

        // Search for text content divs
        const paragraphs = Array.from(post.querySelectorAll('p, span')).map(p => ({
          tag: p.tagName.toLowerCase(),
          text: p.innerText.trim().substring(0, 100),
          classes: p.className
        })).filter(p => p.text.length > 5);

        return {
          outerHTML: post.outerHTML.substring(0, 3000),
          links,
          buttons,
          paragraphs: paragraphs.slice(0, 15)
        };
      }, postContainerSelector);

      console.log('\n--- FIRST POST ANALYSIS ---');
      console.log('Links found inside post:');
      data.links.forEach(l => {
        console.log(`- Text: "${l.text}" | href: ${l.href} | data-view-name: ${l.viewName}`);
      });

      console.log('\nButtons found inside post:');
      data.buttons.forEach(b => {
        console.log(`- Text: "${b.text}"`);
      });

      console.log('\nParagraphs/Spans found inside post:');
      data.paragraphs.forEach(p => {
        console.log(`- [${p.tag}] Text: "${p.text}" | Class: ${p.classes.split(' ').slice(0, 2).join(' ')}`);
      });

      // Let's also check if there is an attribute like data-urn in Level 13, 14 or 15
      const urns = await page.evaluate((sel) => {
        const post = document.querySelector(sel);
        if (!post) return {};
        
        // Walk up to 3 levels to find URN
        let current = post;
        const urns = {};
        for (let i = 0; i < 4; i++) {
          if (!current) break;
          const u = current.getAttribute('data-urn') || current.getAttribute('data-activity-urn');
          if (u) {
            urns[`level-${i}`] = u;
          }
          current = current.parentNode;
        }
        return urns;
      }, postContainerSelector);
      
      console.log('\nURN attributes found in lineage:', urns);

    } else {
      console.log('No posts found to inspect.');
    }

  } catch (err) {
    console.error('Diagnostics failed:', err);
  } finally {
    await context.close();
  }
}

runDiagnostics();
