// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Postgres pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'library_db',
});

// HEALTH
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/**
 * GET /api/books
 * Returns list of books (id, title, author, genre, available_copies)
 */
app.get('/api/books', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, author, genre, available_copies FROM books ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/books error', err);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

/**
 * GET /api/requests
 * Returns list of book requests
 */
app.get('/api/requests', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, author, requested_by, requested_on, status FROM book_requests ORDER BY requested_on DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/requests error', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * POST /api/requests
 * Create a new book request
 * Body: { title, author, requested_by }
 * NOTE: For better reliability, consider storing book_id in the request in future.
 */
app.post('/api/requests', async (req, res) => {
  const { title, author, requested_by } = req.body || {};
  if (!title || !requested_by) {
    return res.status(400).json({ error: 'title and requested_by are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO book_requests (title, author, requested_by)
       VALUES ($1, $2, $3) RETURNING id, title, author, requested_by, requested_on, status`,
      [title, author || null, requested_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/requests error', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// PATCH /api/requests/:id  (replace existing handler)
app.patch('/api/requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be Approved, Rejected, or Pending' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // lock the request row
    const rqRes = await client.query('SELECT * FROM book_requests WHERE id = $1 FOR UPDATE', [id]);
    if (rqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const request = rqRes.rows[0];

    // If the request is already in the desired status, do nothing (avoid double-decrement)
    if (request.status === status) {
      await client.query('ROLLBACK');
      return res.status(200).json({ message: 'No change needed', ...request });
    }

    // If approving, ensure a copy exists and decrement atomically.
    if (status === 'Approved') {
      const bookRes = await client.query(
        `SELECT id, available_copies FROM books WHERE LOWER(title) = LOWER($1) FOR UPDATE`,
        [request.title]
      );

      if (bookRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Book not found in inventory' });
      }

      const book = bookRes.rows[0];
      if (book.available_copies <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No copies available' });
      }

      await client.query('UPDATE books SET available_copies = available_copies - 1 WHERE id = $1', [book.id]);
    }

    // If moving from Approved -> something else (unlikely), you might want to increment copies back.
    // We do not implement auto-increment on Rejected here. If you want that behavior, add logic to handle previous status.

    const upd = await client.query(
      `UPDATE book_requests SET status = $1 WHERE id = $2 RETURNING id, title, author, requested_by, requested_on, status`,
      [status, id]
    );

    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/requests/:id transaction error', err);
    res.status(500).json({ error: 'Failed to update request' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/teams/message
 * Simulated Teams message endpoint for demo.
 * Body: { from, message }
 */
app.post('/api/teams/message', async (req, res) => {
  const { from, message } = req.body || {};
  if (!message) return res.status(400).json({ reply: 'Please send a message' });

  const m = String(message || '').trim();
  const lower = m.toLowerCase();

  try {
    if (lower === 'view books') {
      const booksRes = await pool.query('SELECT title, available_copies FROM books ORDER BY id');
      const list = booksRes.rows.map((b, i) => `${i + 1}. ${b.title} (${b.available_copies} copies)`).join('\n');
      return res.json({ reply: `📚 Available Books:\n${list}` });
    }

    if (lower.startsWith('request book')) {
      const title = m.slice('request book'.length).trim();
      if (!title) return res.json({ reply: 'Please specify book name: request book <book name>' });

      await pool.query(
        `INSERT INTO book_requests (title, requested_by) VALUES ($1, $2)`,
        [title, from || 'unknown']
      );
      return res.json({ reply: `✅ Your request for "${title}" has been recorded.` });
    }

    return res.json({ reply: 'Unknown command. Try "view books" or "request book <book name>"' });
  } catch (err) {
    console.error('/api/teams/message error', err);
    res.status(500).json({ reply: 'Server error' });
  }
});

// fallback to serve index.html for routes (optional)
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
