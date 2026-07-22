const mongoose = require('mongoose');

// ─── Connection ───────────────────────────────────────────────────────────────
let isConnected = false;

async function connectDb() {
  if (isConnected && mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set.');
  }

  await mongoose.connect(uri);
  isConnected = true;
  console.log('Connected to MongoDB');
}

// ─── Query Schema ─────────────────────────────────────────────────────────────
const querySchema = new mongoose.Schema(
  {
    id:       { type: String, required: true, unique: true },
    title:    { type: String, required: true },
    keywords: { type: String, required: true },
    active:   { type: Boolean, default: true },
  },
  { _id: false } // use our own `id` field, not Mongo's ObjectId
);

// ─── Post Schema ──────────────────────────────────────────────────────────────
const postSchema = new mongoose.Schema(
  {
    id:              { type: String, required: true, unique: true },
    queryId:         { type: String, default: '' },
    queryTitle:      { type: String, default: '' },
    authorName:      { type: String, default: 'LinkedIn User' },
    authorUrl:       { type: String, default: '' },
    authorHeadline:  { type: String, default: '' },
    content:         { type: String, default: '' },
    timeElapsed:     { type: String, default: '' },
    url:             { type: String, default: '' },
    status:          { type: String, default: 'New' },
    notes:           { type: String, default: '' },
    scrapedAt:       { type: String, default: () => new Date().toISOString() },
  },
  { _id: false }
);

// Prevent model re-registration in hot-reload / serverless environments
const Query = mongoose.models.Query || mongoose.model('Query', querySchema);
const Post  = mongoose.models.Post  || mongoose.model('Post',  postSchema);

module.exports = { connectDb, Query, Post };
