const apiBase = '/api';

async function fetchRequests() {
  showMessage('Fetching requests...');
  try {
    const res = await fetch(`${apiBase}/requests`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    renderTable(data);
    showMessage(`Loaded ${data.length} requests.`);
  } catch (err) {
    console.error(err);
    showMessage('Error loading requests. Check server.', true);
  }
}

function showMessage(msg, isError = false) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = isError ? 'crimson' : '#666';
}

function renderTable(rows) {
  const tbody = document.querySelector('#requests-table tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">No requests found</td></tr>`;
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');

    const requestedOn = new Date(r.requested_on).toLocaleString();

    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.requested_by || '')}</td>
      <td>${requestedOn}</td>
      <td>${r.status}</td>
      <td>
        <button class="approve" data-id="${r.id}">Approve</button>
        <button class="reject" data-id="${r.id}">Reject</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // attach handlers
  document.querySelectorAll('button.approve').forEach(btn => {
    btn.addEventListener('click', () => updateStatus(btn.dataset.id, 'Approved'));
  });
  document.querySelectorAll('button.reject').forEach(btn => {
    btn.addEventListener('click', () => updateStatus(btn.dataset.id, 'Rejected'));
  });
}

async function updateStatus(id, status) {
  if (!confirm(`Set request #${id} to "${status}"?`)) return;
  try {
    const res = await fetch(`${apiBase}/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Update failed');
    }
    const updated = await res.json();
    showMessage(`Request ${id} updated to ${updated.status}`);
    // refresh list
    await fetchRequests();
  } catch (err) {
    console.error(err);
    showMessage('Failed to update. See console.', true);
  }
}

// basic escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// initial load
fetchRequests();
