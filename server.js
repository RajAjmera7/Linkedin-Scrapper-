const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const { connectDb, Query, Post } = require('./db/mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Memory storage for scraper process and logs
let scraperProcess = null;
let scraperLogs    = [];

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// 1. Get all queries
app.get('/api/queries', async (req, res) => {
  try {
    const queries = await Query.find({}).lean();
    res.json(queries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create or Update query
app.post('/api/queries', async (req, res) => {
  try {
    const query = req.body;

    if (!query.title || !query.keywords) {
      return res.status(400).json({ error: 'Title and Keywords are required.' });
    }

    if (query.id) {
      // Update existing
      const updated = await Query.findOneAndUpdate(
        { id: query.id },
        query,
        { upsert: true, new: true, lean: true }
      );
      return res.json(updated);
    } else {
      // Create new
      query.id     = 'q_' + Date.now();
      query.active = query.active !== undefined ? query.active : true;
      const created = await Query.create(query);
      return res.json(created.toObject());
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Delete query
app.delete('/api/queries/:id', async (req, res) => {
  try {
    await Query.deleteOne({ id: req.params.id });
    res.json({ message: 'Query deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get all posts/leads — sorted by scrapedAt descending
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find({}).sort({ scrapedAt: -1 }).lean();
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Update post status or notes
app.patch('/api/posts/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const update = {};
    if (status)          update.status = status;
    if (notes !== undefined) update.notes  = notes;

    const updated = await Post.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { new: true, lean: true }
    );

    if (!updated) return res.status(404).json({ error: 'Post not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete single post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    await Post.deleteOne({ id: req.params.id });
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Start scraper
app.post('/api/scrape/start', (req, res) => {
  if (scraperProcess) {
    return res.status(400).json({ error: 'Scraper is already running' });
  }

  scraperLogs = [];
  scraperLogs.push(`[${new Date().toLocaleTimeString()}] [SYSTEM] Launching scraper sub-process...`);

  scraperProcess = spawn('node', ['scraper.js'], { cwd: __dirname });

  scraperProcess.stdout.on('data', (data) => {
    data.toString().split('\n').forEach(line => {
      if (line.trim()) scraperLogs.push(`[${new Date().toLocaleTimeString()}] ${line.trim()}`);
    });
  });

  scraperProcess.stderr.on('data', (data) => {
    data.toString().split('\n').forEach(line => {
      if (line.trim()) scraperLogs.push(`[${new Date().toLocaleTimeString()}] [ERROR] ${line.trim()}`);
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
  res.json({ running: scraperProcess !== null, logs: scraperLogs });
});

// 10. Generate personalized cold pitch (rule-based templates)
app.post('/api/posts/:id/pitch', async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id }).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { templateType, customRole } = req.body;
    const authorFirstName = post.authorName ? post.authorName.split(' ')[0] : 'there';
    const role = customRole || post.queryTitle || 'Freelancer';

    const detectedSkills = [];
    const lowerContent   = post.content.toLowerCase();
    const techKeywords   = [
      'react', 'node', 'python', 'vue', 'angular', 'javascript', 'typescript',
      'aws', 'wordpress', 'figma', 'shopify', 'design', 'copywriting', 'writer',
      'php', 'django', 'flask', 'flutter', 'tailwind',
    ];
    techKeywords.forEach(tech => {
      if (lowerContent.includes(tech))
        detectedSkills.push(tech.charAt(0).toUpperCase() + tech.slice(1));
    });

    const skillsList = detectedSkills.length > 0 ? detectedSkills.join(', ') : 'this field';

    let pitch = '';

    if (templateType === 'problem_solver') {
      pitch = `Hi ${authorFirstName},

I saw your recent post looking for a ${role}. 

Based on your description, it sounds like you need someone who can jump in and solve the core challenges around ${skillsList} without needing a long onboarding phase. 

I've worked on similar projects recently, delivering clean code and helping companies get their products shipped on time. You can check out my portfolio / projects here: [Insert Link]

Would you be open to a quick 10-minute call this week to see if my background matches what you need?

Best regards,
[Your Name]`;
    } else if (templateType === 'casual') {
      pitch = `Hi ${authorFirstName},

Hope you're having a great week. I came across your post about needing help with ${role} work. 

I specialize in ${skillsList} and have worked with clients in similar niches. I'd love to learn more about the scope and see if I can help you knock this out.

Here is a link to some of my recent projects: [Insert Link]

Let me know if you have some time to chat!

Thanks,
[Your Name]`;
    } else {
      pitch = `Hi ${authorFirstName},

I noticed your post looking for a ${role} and wanted to reach out.

I am a freelance software engineer specializing in ${skillsList}. I have extensive experience building scalable solutions and can start immediately to support your project.

I'd love to share my relevant work and see how we can work together. Are you available for a brief chat tomorrow?

Best,
[Your Name]`;
    }

    res.json({ pitch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
