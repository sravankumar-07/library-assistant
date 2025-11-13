require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// serve frontend static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

// health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// get books
app.get('/api/books', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/books error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// get all book requests (for dashboard)
app.get('/api/requests', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM book_requests ORDER BY requested_on DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/requests error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// create a new request (student)
app.post('/api/requests', async (req, res) => {
  const { title, author, requested_by } = req.body;
  try {
    const query = `
      INSERT INTO book_requests (title, author, requested_by)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await pool.query(query, [title, author, requested_by]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/requests error:', err);
    res.status(500).json({ error: 'Insert failed' });
  }
});

// update request status (approve / reject)
app.patch('/api/requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // expected 'Approved' or 'Rejected' or 'Pending'
  if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const updateQuery = `
      UPDATE book_requests
      SET status = $1
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [status, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/requests/:id error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// simulated Teams message (kept for demo)
app.post('/api/teams/message', async (req, res) => {
  const { from, message } = req.body;
  if (!message) return res.status(400).json({ reply: 'Please enter a valid message' });
  const lower = message.toLowerCase();

  try {
    if (lower === 'view books') {
      const books = await pool.query('SELECT title, available_copies FROM books ORDER BY id');
      const list = books.rows.map((b, i) => `${i + 1}. ${b.title} (${b.available_copies} copies)`).join('\n');
      return res.json({ reply: `📚 Available Books:\n${list}` });
    }

    if (lower.startsWith('request book')) {
      const title = message.slice('request book'.length).trim();
      if (!title) return res.json({ reply: 'Please specify a book name' });
      await pool.query('INSERT INTO book_requests (title, requested_by) VALUES ($1, $2)', [title, from]);
      return res.json({ reply: `✅ Your request for "${title}" has been recorded.` });
    }

    return res.json({ reply: 'Unknown command. Try "view books" or "request book <book name>"' });
  } catch (err) {
    console.error('/api/teams/message error:', err);
    res.status(500).json({ reply: 'Server error' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
