const apiBase = '/api';
let currentFilters = { status: '', q: '' };

// UI helpers
function showMessage(msg, isError = false) {
  const el = document.getElementById('status-msg');
  if (el) { el.textContent = msg; el.style.color = isError ? 'crimson' : '#666'; }
  else console.log(msg);
}
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// toggle filter button panel
const filterToggle = document.getElementById('filter-toggle');
const filterButtonsWrap = document.getElementById('filter-buttons');
if (filterToggle && filterButtonsWrap) {
  filterToggle.addEventListener('click', () => {
    const hidden = filterButtonsWrap.classList.contains('hidden');
    if (hidden) { filterButtonsWrap.classList.remove('hidden'); filterButtonsWrap.setAttribute('aria-hidden','false'); }
    else { filterButtonsWrap.classList.add('hidden'); filterButtonsWrap.setAttribute('aria-hidden','true'); }
  });
  // hide if clicked outside
  document.addEventListener('click', (e) => {
    if (!filterButtonsWrap.contains(e.target) && e.target !== filterToggle) {
      filterButtonsWrap.classList.add('hidden');
      filterButtonsWrap.setAttribute('aria-hidden','true');
    }
  });
}

// clicking one of the status buttons sets the filter and refreshes
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.filter-btn');
  if (!btn) return;
  const status = btn.dataset.status || '';
  currentFilters = { status, q: '' };
  // set search box empty visually
  const sb = document.getElementById('search-box');
  if (sb) sb.value = '';
  // hide filter panel
  if (filterButtonsWrap) { filterButtonsWrap.classList.add('hidden'); filterButtonsWrap.setAttribute('aria-hidden','true'); }
  fetchRequests(currentFilters);
});

// apply and clear buttons
const applyBtn = document.getElementById('apply-filter');
const clearBtn = document.getElementById('clear-filter');
if (applyBtn) {
  applyBtn.addEventListener('click', () => {
    const statusSel = currentFilters.status || '';
    const q = (document.getElementById('search-box') || {}).value || '';
    currentFilters = { status: statusSel, q: q.trim() };
    fetchRequests(currentFilters);
  });
}
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    currentFilters = { status: '', q: '' };
    const sb = document.getElementById('search-box');
    if (sb) sb.value = '';
    fetchRequests(currentFilters);
  });
}

// fetch helper with basic error handling
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(()=>null);
    throw new Error(`${res.status} ${res.statusText} ${text || ''}`);
  }
  return res.json();
}

// get books and create a map title->book
async function fetchBooksMap() {
  try {
    const books = await fetchJson(`${apiBase}/books`);
    const m = {};
    books.forEach(b => { if (b.title) m[b.title.toLowerCase()] = b; });
    return m;
  } catch (err) {
    console.error('fetchBooksMap', err);
    showMessage('Warning: could not fetch books; copies not shown.', true);
    return {};
  }
}

// main fetch requests with client-side filtering
async function fetchRequests(filters = {}) {
  showMessage('Fetching requests...');
  try {
    const data = await fetchJson(`${apiBase}/requests`);
    let items = Array.isArray(data) ? data : [];
    // normalize and filter
    if (filters.status) {
      const s = String(filters.status).trim().toLowerCase();
      items = items.filter(r => (r.status || '').toString().trim().toLowerCase() === s);
    }
    if (filters.q) {
      const q = String(filters.q).trim().toLowerCase();
      items = items.filter(r => (r.title || '').toLowerCase().includes(q) || (r.requested_by || '').toLowerCase().includes(q));
    }
    const booksMap = await fetchBooksMap();
    renderTable(items, booksMap);
    showMessage(`Loaded ${items.length} requests.`);
  } catch (err) {
    console.error('fetchRequests', err);
    showMessage('Failed to load requests. See console.', true);
    renderTable([], {});
  }
}

// render rows; show copies and disable buttons accordingly
function renderTable(rows, booksMap = {}) {
  const tbody = document.querySelector('#requests-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">No requests found</td></tr>`;
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    const requestedOn = r.requested_on ? new Date(r.requested_on).toLocaleString() : '';
    const book = booksMap[(r.title || '').toLowerCase()];
    const copies = (book && typeof book.available_copies === 'number') ? book.available_copies : null;
    const approveDisabled = (String(r.status || '').toLowerCase() === 'approved') || (copies !== null && copies <= 0);
    const rejectDisabled = (String(r.status || '').toLowerCase() === 'rejected') || (String(r.status || '').toLowerCase() === 'approved');

    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.requested_by || '')}</td>
      <td>${requestedOn}</td>
      <td>${r.status || ''}</td>
      <td class="copies">${copies === null ? '-' : copies}</td>
      <td>
        <button class="approve" data-id="${r.id}" ${approveDisabled ? 'disabled' : ''}>Approve</button>
        <button class="reject" data-id="${r.id}" ${rejectDisabled ? 'disabled' : ''}>Reject</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // attach handlers (only to enabled buttons)
  tbody.querySelectorAll('button.approve').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => updateStatus(b.dataset.id, 'Approved', b));
  });
  tbody.querySelectorAll('button.reject').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => updateStatus(b.dataset.id, 'Rejected', b));
  });
}

// updateStatus disables row buttons while request is in-flight and refreshes after success
// Replace existing updateStatus with this function in public/app.js
async function updateStatus(id, status, sourceButton) {
  if (!confirm(`Set request #${id} to "${status}"?`)) return;

  const tr = sourceButton.closest('tr');
  const approveBtn = tr.querySelector('button.approve');
  const rejectBtn = tr.querySelector('button.reject');

  // disable UI for this row while updating
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn) rejectBtn.disabled = true;

  showMessage(`Updating request ${id}...`);

  try {
    const res = await fetch(`${apiBase}/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    const body = await res.json();

    if (!res.ok) {
      // re-enable buttons for retry
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
      throw new Error(body.error || body.message || 'Update failed');
    }

    // Successful update: update only this row in the DOM
    // 1) Update Status cell (5th column in our table)
    const statusCell = tr.children[4];
    if (statusCell) statusCell.textContent = body.status || status;

    // 2) If approval succeeded, decrement the Copies cell for the matching book
    // Copies cell is at index 5 (0-based), class 'copies'
    const copiesCell = tr.querySelector('td.copies');
    if (copiesCell && typeof copiesCell.textContent !== 'undefined') {
      // if copies shown as number, decrement by 1; if '-', leave as '-'
      const cur = copiesCell.textContent.trim();
      const n = Number(cur);
      if (!Number.isNaN(n)) {
        copiesCell.textContent = String(Math.max(0, n - (status === 'Approved' ? 1 : 0)));
      }
    }

    // 3) Disable buttons permanently if appropriate:
    // - if Approved: approve disabled; reject disabled (no further action)
    // - if Rejected: approve disabled; reject disabled
    if (body.status === 'Approved') {
      if (approveBtn) approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;
    } else if (body.status === 'Rejected') {
      if (approveBtn) approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;
    } else {
      // Pending - re-enable buttons (unlikely after an update but included for safety)
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
    }

    showMessage(`Request ${id} updated to ${body.status || status}`);
  } catch (err) {
    console.error('updateStatus error', err);
    showMessage('Failed to update: ' + err.message, true);
  }
}


// initial load
fetchRequests(currentFilters);
