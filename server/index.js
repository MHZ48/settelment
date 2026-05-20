require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors    = require('cors');
const db      = require('./db');

const app     = express();
const PORT    = process.env.PORT    || 3001;
const API_KEY = process.env.API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// SSE clients
const clients = new Set();

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (API_KEY && key !== API_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => { try { c.write(msg); } catch { clients.delete(c); } });
}

// Real-time stream (SSE)
app.get('/api/sessions/stream', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Get all sessions
app.get('/api/sessions', auth, (req, res) => {
  const rows = db.getAll();
  const result = {};
  rows.forEach(row => {
    let state = row.state;
    try { state = JSON.parse(row.state); } catch {}
    result[row.case_number] = {
      caseNumber: row.case_number,
      title:      row.title,
      createdAt:  row.created_at,
      updatedAt:  row.updated_at,
      state
    };
  });
  res.json(result);
});

// Upsert session
app.post('/api/sessions/upsert', auth, (req, res) => {
  const { caseNum, title, state, updatedAt } = req.body;
  if (!caseNum) return res.status(400).json({ error: 'caseNum required' });
  db.upsert(caseNum, title, state, updatedAt);
  broadcast('upsert', { caseNum, title, state, updatedAt });
  res.json({ ok: true });
});

// Delete session
app.post('/api/sessions/delete', auth, (req, res) => {
  const { caseNum } = req.body;
  if (!caseNum) return res.status(400).json({ error: 'caseNum required' });
  db.remove(caseNum);
  broadcast('delete', { caseNum });
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`✓ Server: http://localhost:${PORT}  (API_KEY: ${API_KEY ? '***set***' : 'none'})`)
);
