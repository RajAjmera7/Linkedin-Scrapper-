const { chromium } = require('playwright');
const path   = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Helper to wait for a random time (anti-detection)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 2000, max = 5000) => delay(Math.floor(Math.random() * (max - min + 1)) + min);

const USER_DATA_DIR = path.join(__dirname, 'user_data');

const { connectDb, Query, Post } = require('./db/mongoose');

// Load active queries from MongoDB
async function loadActiveQueries() {
  return Query.find({ active: true }).lean();
}

// Load all existing post IDs from MongoDB (for dedup)
async function loadExistingIds() {
  const posts = await Post.find({}, { id: 1, _id: 0 }).lean();
  return new Set(posts.map(p => p.id));
}

// Save a batch of new posts to MongoDB
async function savePosts(newPosts) {
  if (!newPosts.length) return;
  // bulkWrite with upsert to avoid duplicates on concurrent runs
  const ops = newPosts.map(p => ({
    updateOne: {
      filter: { id: p.id },
      update: { $setOnInsert: p },
      upsert: true,
    },
  }));
  await Post.bulkWrite(ops);
}

async function runScraper() {
  console.log('=== Starting LinkedIn Freelance Post Finder Scraper ===');

  await connectDb();

  const activeQueries = await loadActiveQueries();

  if (activeQueries.length === 0) {
    console.log('No active search queries found. Exiting.');
    return;
  }

  console.log(`Found ${activeQueries.length} active queries to run.`);

  // Launch browser with persistent context (stores cookies, sessions, cache)
  console.log('Launching browser with persistent profile...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // Run headed so user can log in and view pages if needed
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await context.newPage();

  // Set standard headers and user agent to look like a real browser
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9'
  });

  try {
    // 1. Check Login Status
    console.log('Checking login status on LinkedIn...');
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await randomDelay(3000, 5000);

    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/signup') || currentUrl.includes('/login') || currentUrl.includes('/checkpoint');

    if (isLoginPage) {
      console.log('--------------------------------------------------');
      console.log('ACTION REQUIRED: You are not logged in to LinkedIn.');
      console.log('Please log in manually in the opened browser window.');
      console.log('The script will wait for you to complete login...');
      console.log('--------------------------------------------------');

      // Wait for user to log in - we poll for '/feed' or feed elements up to 10 minutes
      let loggedIn = false;
      for (let i = 0; i < 120; i++) {
        await delay(5000);
        const url = page.url();
        if (url.includes('/feed') && !url.includes('/login')) {
          console.log('Login detected! Resuming scraper in 5 seconds...');
          await delay(5000);
          loggedIn = true;
          break;
        }
      }

      if (!loggedIn) {
        console.log('Login timeout (10 minutes exceeded). Exiting scraper.');
        await context.close();
        return;
      }
    } else {
      console.log('Logged in successfully (restored active session).');
    }

    // 2. Loop through each active query
    for (const query of activeQueries) {
      console.log(`\n--- Running Search for: "${query.title}" ---`);
      
      const existingIds = await loadExistingIds();
      const newPosts = [];
      let newPostsCount = 0;

      // Define sequential sweeps: Sweep 1 (Latest) then Sweep 2 (Relevance)
      const sweeps = [
        { name: 'Latest', sortBy: 'date_posted' },
        { name: 'Relevance', sortBy: '' }
      ];

      for (const sweep of sweeps) {
        try {
          console.log(`\n  -> Running ${sweep.name}-sorted sweep...`);
          const sortParam = sweep.sortBy ? `&sortBy=%22${sweep.sortBy}%22` : '';
          const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query.keywords)}${sortParam}&datePosted=%22past-24h%22`;
          console.log(`     Navigating to: ${searchUrl}`);
          
          await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
          await randomDelay(4000, 7000);

          // Check if page loaded or if we hit a verification check
          if (page.url().includes('checkpoint')) {
            console.log('LinkedIn security verification check detected! Please solve it in the browser window.');
            await page.waitForURL(url => !url.includes('checkpoint'), { timeout: 300000 }); // Wait up to 5 mins
            console.log('Verification solved. Resuming...');
            await randomDelay(3000, 5000);
          }

          // Check if any results are present
          const noResultsLocator = page.locator('.search-reusables__no-results, .reusable-search-no-results__container');
          const hasNoResults = await noResultsLocator.isVisible().catch(() => false);
          if (hasNoResults) {
            console.log(`     No posts found in ${sweep.name} sweep.`);
            continue;
          }

          // Scroll down dynamically to load more posts
          console.log('     Scrolling down to load recent posts...');
          for (let s = 0; s < 3; s++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
            await randomDelay(1500, 3000);
          }

          // Click "See more" on long posts to expand content
          console.log('     Expanding posts (clicking "See more")...');
          const seeMoreButtons = page.locator('button.feed-shared-inline-show-more-text__see-more-less-toggle, button[aria-label*="see more"]');
          const btnCount = await seeMoreButtons.count();
          for (let b = 0; b < btnCount; b++) {
            try {
              await seeMoreButtons.nth(b).click({ timeout: 1500 });
            } catch (clickErr) {
              // Ignore if button is not clickable or already clicked
            }
          }

          // Extract post details
          console.log('     Extracting post details...');
          await page.screenshot({ path: path.join(__dirname, 'public', 'scraper-screenshot.png') });
          console.log('     ✓ Debug screenshot saved to public/scraper-screenshot.png');

          const postContainers = page.locator('div[role="listitem"]');
          const totalPosts = await postContainers.count();
          console.log(`     Found ${totalPosts} post elements on the page.`);

          for (let i = 0; i < totalPosts; i++) {
            try {
              const container = postContainers.nth(i);
              // Evaluate post card content inside the browser using selector-free semantic matching
              const postData = await container.evaluate((el) => {
                // Find any direct links inside the card (feed update, job views, or articles)
                const feedLink = el.querySelector('a[href*="/feed/update/"]');
                const jobLink = el.querySelector('a[href*="/jobs/view/"]');
                const articleLink = el.querySelector('a[href*="/pulse/"]');
                
                let postUrl = '';
                if (feedLink) postUrl = feedLink.href.split('?')[0];
                else if (jobLink) postUrl = jobLink.href.split('?')[0];
                else if (articleLink) postUrl = articleLink.href.split('?')[0];

                // 1. Author Name and Profile Link (look for profile links containing /in/ that actually have text first)
                let actorLink = Array.from(el.querySelectorAll('a[href*="/in/"]')).find(a => a.innerText.trim().length > 0);
                if (!actorLink) {
                  actorLink = el.querySelector('a[data-view-name*="actor"]');
                }
                const authorName = actorLink && actorLink.innerText.trim() ? actorLink.innerText.split('\n')[0].trim() : 'LinkedIn User';
                const authorUrl = actorLink ? actorLink.href.split('?')[0] : '';

                // 2. Author Headline (only search inside <p> elements to avoid "Feed post" span)
                let authorHeadline = '';
                const pElements = Array.from(el.querySelectorAll('p')).filter(x => {
                  const txt = x.innerText.trim();
                  return txt.length > 5 && !txt.includes('•') && !txt.includes('Follow') && !txt.includes(authorName);
                });
                const headlineEl = pElements.find(p => p.innerText.length < 150);
                if (headlineEl) authorHeadline = headlineEl.innerText.trim();

                // 3. Post Content / Text
                let content = '';
                const textElements = Array.from(el.querySelectorAll('p, span')).filter(x => {
                  const txt = x.innerText.trim();
                  return txt.length > 20 && !txt.includes(authorName) && !txt.includes('Follow') && !txt.includes('•');
                });
                if (textElements.length > 0) {
                  // Find the longest text element which corresponds to the post body
                  const mainTextEl = textElements.reduce((max, curr) => curr.innerText.length > max.innerText.length ? curr : max, textElements[0]);
                  content = mainTextEl.innerText.trim();
                }

                // 4. Time Elapsed
                let timeElapsed = 'Recent';
                const timeEl = Array.from(el.querySelectorAll('span, p')).find(x => {
                  const txt = x.innerText.trim();
                  return txt.includes('•') || /^\d+[hdmw]$/.test(txt);
                });
                if (timeEl) {
                  timeElapsed = timeEl.innerText.replace('•', '').trim();
                }

                // 5. Extract Activity URN directly from URL if possible
                let urn = '';
                if (postUrl) {
                  const urnMatch = postUrl.match(/urn:li:activity:\d+/);
                  if (urnMatch) {
                    urn = urnMatch[0];
                  } else {
                    const segments = postUrl.split('/');
                    const lastSegment = segments[segments.length - 1] || segments[segments.length - 2];
                    if (lastSegment && lastSegment.startsWith('urn:')) {
                      urn = lastSegment;
                    }
                  }
                }

                return { authorName, authorUrl, authorHeadline, content, timeElapsed, urn, postUrl };
              });

              if (!postData.content || postData.content.length < 45) {
                // Skip empty, extremely short, or spammy email-only cards
                continue;
              }

              // Filter out profile cards that sometimes get loaded in the list (their content is just their headline)
              if (postData.content === postData.authorHeadline) {
                continue;
              }

              // Grading Relevance Locally (skipping freelancer self-ads and general articles/newsletter spam)
              const text = postData.content.toLowerCase();
              const headline = postData.authorHeadline.toLowerCase();

              // Blacklist keywords indicating the author is a freelancer advertising their own services
              const freelancerIndicators = [
                "i'm a freelancer", "i am a freelancer", "i'm a freelance", "i am a freelance",
                "i'm currently looking for", "i am currently looking for", "looking for a local or remote",
                "i'm open to full-time", "i'm open to freelance", "i am open to", "open to new opportunities", 
                "seeking new opportunities", "open to work", "open for work", "open for freelance",
                "hire me", "hire my agency", "my services include", "our services include", "we specialize in", "specializing in",
                "my portfolio", "my resume", "my cv", "check out my website", "my fiverr gig", "on fiverr", "fiverr.com", "upwork.com",
                "fiverr seller", "upwork freelancer", "available for new projects", "available for freelance", "available for hire",
                "offering my services", "trial task", "free trial", "my newest piece", "my latest project", "my new website", 
                "website is live", "grow your business", "helping businesses build", "is your website bringing you business", 
                "reparei uma coisa", "vocês concordam", "daily industry trends", "17 websites", "27 platforms", 
                "remote work opportunities in 2026", "stop babysitting servers", "work with me", "shoes - e-ticaret"
              ];

              const isFreelancerAd = freelancerIndicators.some(indicator => text.includes(indicator) || headline.includes(indicator));
              if (isFreelancerAd) {
                // Silently skip duplicates or self-ads
                continue;
              }

              // Whitelist keywords indicating active hiring intent
              const hiringIndicators = [
                "hiring", "we're hiring", "we are hiring", "hiring alert", "hiring a", "hiring an",
                "looking for", "we're looking for", "we are looking for", "looking to hire", "looking to bring on",
                "seeking", "we're seeking", "we are seeking", "seeking a", "seeking an",
                "we need", "needs a", "need a", "client needs", "urgently need",
                "looking to collaborate", "looking for freelance", "seeking freelance",
                "contract role", "freelance gig", "freelance opportunity", "contract opportunity",
                "dm me your portfolio", "send your resume", "send your portfolio", "email your cv", "send portfolio"
              ];

              const isHiring = hiringIndicators.some(indicator => text.includes(indicator));
              if (!isHiring) {
                // Silently skip cards without hiring intent
                continue;
              }

              // Generate URN/ID hash if LinkedIn didn't provide one
              let urn = postData.urn;
              if (!urn) {
                const hash = crypto.createHash('md5').update(postData.authorName + postData.content.substring(0, 100)).digest('hex');
                urn = `urn:local:post:${hash}`;
              }

              if (existingIds.has(urn)) {
                // Post already exists in DB, skip it
                continue;
              }

              existingIds.add(urn); // Prevent duplicate adds in same batch

              // Construct post URL (direct URL or fallback to profile if missing)
              const postUrl = postData.postUrl || (postData.urn ? `https://www.linkedin.com/feed/update/${postData.urn}` : postData.authorUrl);

              // Add to temporary batch array
              const newPost = {
                id: urn,
                queryId: query.id,
                queryTitle: query.title,
                authorName: postData.authorName,
                authorUrl: postData.authorUrl,
                authorHeadline: postData.authorHeadline,
                content: postData.content,
                timeElapsed: postData.timeElapsed,
                url: postUrl,
                status: 'New',
                notes: '',
                scrapedAt: new Date().toISOString()
              };

              newPosts.push(newPost);
              console.log(`     [NEW LEAD] Found post by ${postData.authorName}: "${postData.content.substring(0, 60)}..."`);
            } catch (postError) {
              console.error('     Error parsing post item:', postError.message);
            }
          }
        } catch (sweepError) {
          console.error(`     Error during ${sweep.name} sweep:`, sweepError.message);
        }
        
        await randomDelay(3000, 6000); // Delay between sweeps
      }

      // Save new posts to MongoDB
      if (newPosts.length > 0) {
        await savePosts(newPosts);
        newPostsCount = newPosts.length;
      }

      console.log(`Finished query "${query.title}". Found ${newPostsCount} new posts (combined Latest + Relevance).`);
      await randomDelay(3000, 6000); // Wait before next query
    }

    console.log('\nAll active queries processed successfully!');
  } catch (error) {
    console.error('Scraper encountered an error:', error);
  } finally {
    console.log('Closing browser...');
    await context.close();
    console.log('Scraper run finished.');
  }
}

// Run if called directly
if (require.main === module) {
  runScraper();
}

module.exports = { runScraper };
