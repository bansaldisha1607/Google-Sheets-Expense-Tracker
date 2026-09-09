let currentSheetId = null;
let allExpenses = [];

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* Extracts a spreadsheet ID whether the user pastes a full URL or a bare ID */
function extractSheetId(input) {
  const match = input.match(/[-\w]{25,}/);
  return match ? match[0] : input.trim();
}

function fmtMoney(n) {
  return '₹' + Number(n).toFixed(2);
}

/* ---------------- Init ---------------- */

async function init() {
  const me = await api('/api/me');

  $('userBox').innerHTML = `
    <img src="${me.user.picture || ''}" alt="" onerror="this.style.display='none'"/>
    <span>${me.user.name}</span>
    <a class="logout-link" href="/auth/logout">Sign out</a>
  `;

  if (me.selectedSheetId) {
    currentSheetId = me.selectedSheetId;
    showSheetBanner(me.selectedSheetName);
    revealExpenseSections();
    await loadExpenses();
  } else {
    await loadSheetList();
  }

  bindEvents();
}

function showSheetBanner(name) {
  const banner = $('currentSheetBanner');
  banner.classList.remove('hidden');
  banner.textContent = `✓ Currently using: "${name}"`;
}

function revealExpenseSections() {
  $('expenseSection').classList.remove('hidden');
  $('summarySection').classList.remove('hidden');
}

/* ---------------- Step 1: Sheet selection ---------------- */

async function loadSheetList() {
  const listEl = $('sheetList');
  try {
    const { files } = await api('/api/sheets');
    if (!files.length) {
      listEl.innerHTML = '<p class="muted">No existing sheets found. Create a new one, or paste a Sheet URL below.</p>';
      return;
    }
    listEl.innerHTML = files.map(f => `
      <div class="sheet-item">
        <span>${f.name}</span>
        <button class="btn secondary small select-existing-btn" data-id="${f.id}" data-name="${f.name}">Use this</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.select-existing-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSheet(btn.dataset.id));
    });
  } catch (err) {
    listEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function createSheet() {
  const title = $('newSheetTitle').value.trim() || 'My Expense Tracker';
  const btn = $('createSheetBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const data = await api('/api/sheets/create', {
      method: 'POST',
      body: JSON.stringify({ title })
    });
    currentSheetId = data.spreadsheetId;
    showSheetBanner(data.title);
    revealExpenseSections();
    await loadExpenses();
  } catch (err) {
    alert('Could not create sheet: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Create New Sheet';
  }
}

async function selectSheet(idOrUrl) {
  const spreadsheetId = extractSheetId(idOrUrl);
  try {
    const data = await api('/api/sheets/select', {
      method: 'POST',
      body: JSON.stringify({ spreadsheetId })
    });
    currentSheetId = data.spreadsheetId;
    showSheetBanner(data.title);
    revealExpenseSections();
    await loadExpenses();
  } catch (err) {
    alert('Could not use that sheet: ' + err.message);
  }
}

/* ---------------- Step 2: Expenses CRUD ---------------- */

async function loadExpenses() {
  const tbody = $('expenseTbody');
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading expenses…</td></tr>';
  try {
    const { expenses } = await api('/api/expenses');
    allExpenses = expenses;
    renderExpenses();
    renderSummaries();
    updateCategorySuggestions();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="error">${err.message}</td></tr>`;
  }
}

function renderExpenses() {
  const tbody = $('expenseTbody');
  if (!allExpenses.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No expenses yet — add your first one above.</td></tr>';
    return;
  }
  const sorted = [...allExpenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td>${fmtMoney(e.amount)}</td>
      <td>
        <button class="action-btn edit-btn" data-row="${e.rowIndex}">Edit</button>
        <button class="action-btn delete delete-btn" data-row="${e.rowIndex}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.row)));
  tbody.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', () => deleteExpense(b.dataset.row)));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function updateCategorySuggestions() {
  const cats = [...new Set(allExpenses.map(e => e.category).filter(Boolean))];
  $('categoryOptions').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function startEdit(rowIndex) {
  const exp = allExpenses.find(e => String(e.rowIndex) === String(rowIndex));
  if (!exp) return;
  $('editRowIndex').value = exp.rowIndex;
  $('fDate').value = exp.date;
  $('fCategory').value = exp.category;
  $('fDescription').value = exp.description;
  $('fAmount').value = exp.amount;
  $('submitBtn').textContent = 'Save Changes';
  $('cancelEditBtn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  $('expenseForm').reset();
  $('editRowIndex').value = '';
  $('submitBtn').textContent = 'Add Expense';
  $('cancelEditBtn').classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  $('formError').classList.add('hidden');

  const payload = {
    date: $('fDate').value,
    category: $('fCategory').value.trim(),
    description: $('fDescription').value.trim(),
    amount: parseFloat($('fAmount').value)
  };
  const rowIndex = $('editRowIndex').value;

  try {
    if (rowIndex) {
      await api(`/api/expenses/${rowIndex}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelEdit();
    await loadExpenses();
  } catch (err) {
    const errEl = $('formError');
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function deleteExpense(rowIndex) {
  if (!confirm('Delete this expense?')) return;
  try {
    await api(`/api/expenses/${rowIndex}`, { method: 'DELETE' });
    await loadExpenses();
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
}

/* ---------------- Step 3: Summaries ---------------- */

function renderSummaries() {
  const byCategory = {};
  const byMonth = {};
  let grandTotal = 0;

  allExpenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const month = (e.date || '').slice(0, 7); // YYYY-MM
    if (month) byMonth[month] = (byMonth[month] || 0) + e.amount;
    grandTotal += e.amount;
  });

  const catBody = $('categoryTotalsBody');
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  catBody.innerHTML = catEntries.length
    ? catEntries.map(([cat, total]) => `<tr><td>${escapeHtml(cat)}</td><td>${fmtMoney(total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No data yet</td></tr>';

  const monthBody = $('monthlyTotalsBody');
  const monthEntries = Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  monthBody.innerHTML = monthEntries.length
    ? monthEntries.map(([month, total]) => `<tr><td>${formatMonthLabel(month)}</td><td>${fmtMoney(total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No data yet</td></tr>';

  $('grandTotal').textContent = `Grand Total: ${fmtMoney(grandTotal)}`;
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/* ---------------- Wiring ---------------- */

function bindEvents() {
  $('createSheetBtn').addEventListener('click', createSheet);
  $('manualSelectBtn').addEventListener('click', () => {
    const val = $('manualSheetId').value.trim();
    if (val) selectSheet(val);
  });
  $('expenseForm').addEventListener('submit', handleFormSubmit);
  $('cancelEditBtn').addEventListener('click', cancelEdit);
  $('changeSheetBtn').addEventListener('click', async () => {
    currentSheetId = null;
    $('expenseSection').classList.add('hidden');
    $('summarySection').classList.add('hidden');
    $('currentSheetBanner').classList.add('hidden');
    await loadSheetList();
    // Also let them re-select even though server still remembers old sheet
    // until they actually pick a new one via selectSheet().
  });
}

init().catch(err => {
  console.error(err);
  window.location.href = '/';
});
