/**
 * One-time migration: seeds MongoDB with the existing db.json data.
 * Run once with: node db/seed.js
 * Safe to re-run — uses upsert so no duplicates are created.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { connectDb, Query, Post } = require('./mongoose');

const DB_PATH = path.join(__dirname, '..', 'db.json');

async function seed() {
  await connectDb();

  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const data = JSON.parse(raw);

  // Upsert queries
  let qCount = 0;
  for (const q of data.queries || []) {
    await Query.updateOne({ id: q.id }, q, { upsert: true });
    qCount++;
  }
  console.log(`Seeded ${qCount} queries.`);

  // Upsert posts
  let pCount = 0;
  for (const p of data.posts || []) {
    await Post.updateOne({ id: p.id }, p, { upsert: true });
    pCount++;
  }
  console.log(`Seeded ${pCount} posts.`);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
