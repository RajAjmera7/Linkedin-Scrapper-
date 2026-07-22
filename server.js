const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');

// Memory storage for logs and running process
let scraperProcess = null;
let scraperLogs = [];

// Helper to read DB
function readDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading db.json:', err);
  }
  return { queries: [], posts: [] };
}

// Helper to write DB
function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing db.json:', err);
  }
}

// --- API ROUTES ---

// 1. Get all queries
app.get('/api/queries', (req, res) => {
  const db = readDb();
  res.json(db.queries);
});

// 2. Create or Update query
app.post('/api/queries', (req, res) => {
  const db = readDb();
  const query = req.body;

  if (!query.title || !query.keywords) {
    return res.status(400).json({ error: 'Title and Keywords are required.' });
  }

  if (query.id) {
    // Update existing
    const idx = db.queries.findIndex(q => q.id === query.id);
    if (idx !== -1) {
      db.queries[idx] = { ...db.queries[idx], ...query };
    } else {
      db.queries.push(query);
    }
  } else {
    // Create new
    query.id = 'q_' + Date.now();
    query.active = query.active !== undefined ? query.active : true;
    db.queries.push(query);
  }

  writeDb(db);
  res.json(query);
});

// 3. Delete query
app.delete('/api/queries/:id', (req, res) => {
  const db = readDb();
  db.queries = db.queries.filter(q => q.id !== req.params.id);
  writeDb(db);
  res.json({ message: 'Query deleted' });
});

// 4. Get all posts/leads
app.get('/api/posts', (req, res) => {
  const db = readDb();
  // Filter and sort by scraped date descending
  const posts = db.posts.sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt));
  res.json(posts);
});

// 5. Update post status or notes
app.patch('/api/posts/:id', (req, res) => {
  const db = readDb();
  const { status, notes } = req.body;
  const postIdx = db.posts.findIndex(p => p.id === req.params.id);

  if (postIdx === -1) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (status) db.posts[postIdx].status = status;
  if (notes !== undefined) db.posts[postIdx].notes = notes;

  writeDb(db);
  res.json(db.posts[postIdx]);
});

// 6. Delete single post
app.delete('/api/posts/:id', (req, res) => {
  const db = readDb();
  db.posts = db.posts.filter(p => p.id !== req.params.id);
  writeDb(db);
  res.json({ message: 'Post deleted' });
});

// 7. Start scraper
app.post('/api/scrape/start', (req, res) => {
  if (scraperProcess) {
    return res.status(400).json({ error: 'Scraper is already running' });
  }

  scraperLogs = [];
  scraperLogs.push(`[${new Date().toLocaleTimeString()}] [SYSTEM] Launching scraper sub-process...`);

  // Spawn node scraper.js
  scraperProcess = spawn('node', ['scraper.js'], { cwd: __dirname });

  scraperProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        scraperLogs.push(`[${new Date().toLocaleTimeString()}] ${line.trim()}`);
      }
    });
  });

  scraperProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        scraperLogs.push(`[${new Date().toLocaleTimeString()}] [ERROR] ${line.trim()}`);
      }
    });
  });

  scraperProcess.on('close', (code) => {
    scraperLogs.push(`[${new Date().toLocaleTimeString()}] [SYSTEM] Scraper process completed with exit code ${code}`);
    scraperProcess = null;
  });

  res.json({ message: 'Scraper started' });
});

// 8. Stop scraper
app.post('/api/scrape/stop', (req, res) => {
  if (!scraperProcess) {
    return res.status(400).json({ error: 'Scraper is not running' });
  }

  scraperProcess.kill();
  scraperLogs.push(`[${new Date().toLocaleTimeString()}] [SYSTEM] Scraper terminated by user.`);
  scraperProcess = null;
  res.json({ message: 'Scraper stopped' });
});

// 9. Get scraping status and logs
app.get('/api/scrape/status', (req, res) => {
  res.json({
    running: scraperProcess !== null,
    logs: scraperLogs
  });
});

// 10. Generate personalized cold pitch (Rule-based Templates with fallback)
app.post('/api/posts/:id/pitch', (req, res) => {
  const db = readDb();
  const post = db.posts.find(p => p.id === req.params.id);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const { templateType, customRole } = req.body;
  const authorFirstName = post.authorName ? post.authorName.split(' ')[0] : 'there';
  const role = customRole || post.queryTitle || 'Freelancer';

  // Basic keyword matcher to pull tech stacks
  const detectedSkills = [];
  const lowerContent = post.content.toLowerCase();
  const techKeywords = ['react', 'node', 'python', 'vue', 'angular', 'javascript', 'typescript', 'aws', 'wordpress', 'figma', 'shopify', 'design', 'copywriting', 'writer', 'php', 'django', 'flask', 'flutter', 'tailwind'];
  
  techKeywords.forEach(tech => {
    if (lowerContent.includes(tech)) {
      detectedSkills.push(tech.charAt(0).toUpperCase() + tech.slice(1));
    }
  });

  const skillsList = detectedSkills.length > 0 ? detectedSkills.join(', ') : 'this field';

  let pitch = '';

  if (templateType === 'problem_solver') {
    pitch = `Hi ${authorFirstName},

I saw your recent post looking for a ${role}. 

Based on your description, it sounds like you need someone who can jump in and solve the core challenges around ${skillsList ? skillsList : 'your project requirements'} without needing a long onboarding phase. 

I've worked on similar projects recently, delivering clean code and helping companies get their products shipped on time. You can check out my portfolio / projects here: [Insert Link]

Would you be open to a quick 10-minute call this week to see if my background matches what you need?

Best regards,
[Your Name]`;
  } else if (templateType === 'casual') {
    pitch = `Hi ${authorFirstName},

Hope you're having a great week. I came across your post about needing help with ${role} work. 

I specialize in ${skillsList ? skillsList : 'custom software development'} and have worked with clients in similar niches. I'd love to learn more about the scope and see if I can help you knock this out.

Here is a link to some of my recent projects: [Insert Link]

Let me know if you have some time to chat!

Thanks,
[Your Name]`;
  } else {
    // Default: Direct & Professional
    pitch = `Hi ${authorFirstName},

I noticed your post looking for a ${role} and wanted to reach out.

I am a freelance software engineer specializing in ${skillsList ? skillsList : 'full-stack development'}. I have extensive experience building scalable solutions and can start immediately to support your project.

I'd love to share my relevant work and see how we can work together. Are you available for a brief chat tomorrow?

Best,
[Your Name]`;
  }

  res.json({ pitch });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
