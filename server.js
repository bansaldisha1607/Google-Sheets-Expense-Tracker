require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Scopes:
// - openid/email/profile -> know who the user is
// - spreadsheets -> read/write expense data
// - drive.file -> list/create ONLY files this app creates/opens (not full Drive access)
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

const HEADER_ROW = ['Date', 'Category', 'Description', 'Amount'];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getOAuthClientFromSession(req) {
  if (!req.session.tokens) return null;
  const oAuth2Client = createOAuthClient();
  oAuth2Client.setCredentials(req.session.tokens);
  return oAuth2Client;
}

function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireSheet(req, res, next) {
  if (!req.session.sheetId) {
    return res.status(400).json({ error: 'No spreadsheet selected' });
  }
  next();
}

/* ------------------------- AUTH ROUTES ------------------------- */

// Step 1: Redirect user to Google's OAuth consent screen
app.get('/auth/google', (req, res) => {
  const oAuth2Client = createOAuthClient();
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // needed to receive a refresh_token
    prompt: 'consent',
    scope: SCOPES
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with an auth code
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const oAuth2Client = createOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    req.session.tokens = tokens;

    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const { data } = await oauth2.userinfo.get();
    req.session.user = { name: data.name, email: data.email, picture: data.picture };

    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: req.session.user,
    selectedSheetId: req.session.sheetId || null,
    selectedSheetName: req.session.sheetName || null
  });
});

/* -------------------- SHEET LIST / CREATE / SELECT -------------------- */

// List spreadsheets the user has previously opened/created with this app
// (drive.file scope only exposes files this app has access to)
app.get('/api/sheets', requireAuth, async (req, res) => {
  try {
    const auth = getOAuthClientFromSession(req);
    const drive = google.drive({ version: 'v3', auth });
    const result = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 25
    });
    res.json({ files: result.data.files });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to list spreadsheets' });
  }
});

app.post('/api/sheets/create', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const createResp = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: title || 'My Expense Tracker' },
        sheets: [{ properties: { title: 'Expenses' } }]
      }
    });

    const spreadsheetId = createResp.data.spreadsheetId;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Expenses!A1:D1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] }
    });

    req.session.sheetId = spreadsheetId;
    req.session.sheetName = createResp.data.properties.title;

    res.json({ spreadsheetId, title: createResp.data.properties.title });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create spreadsheet' });
  }
});

app.post('/api/sheets/select', requireAuth, async (req, res) => {
  try {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId is required' });

    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = meta.data.sheets.map(s => s.properties.title);

    if (!sheetTitles.includes('Expenses')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: 'Expenses' } } }] }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Expenses!A1:D1',
        valueInputOption: 'RAW',
        requestBody: { values: [HEADER_ROW] }
      });
    } else {
      const headerCheck = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Expenses!A1:D1'
      });
      if (!headerCheck.data.values) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Expenses!A1:D1',
          valueInputOption: 'RAW',
          requestBody: { values: [HEADER_ROW] }
        });
      }
    }

    req.session.sheetId = spreadsheetId;
    req.session.sheetName = meta.data.properties.title;

    res.json({ spreadsheetId, title: meta.data.properties.title });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to select spreadsheet. Make sure the ID is correct and shared with your account.' });
  }
});

/* --------------------------- EXPENSES CRUD --------------------------- */

app.get('/api/expenses', requireAuth, requireSheet, async (req, res) => {
  try {
    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: req.session.sheetId,
      range: 'Expenses!A2:D'
    });

    const rows = result.data.values || [];
    const expenses = rows
      .map((row, i) => ({
        rowIndex: i + 2, // actual row number in the sheet (header is row 1)
        date: row[0] || '',
        category: row[1] || '',
        description: row[2] || '',
        amount: parseFloat(row[3]) || 0
      }))
      // skip fully blank rows left behind by Google Sheets
      .filter(e => e.date || e.category || e.description || e.amount);

    res.json({ expenses });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

app.post('/api/expenses', requireAuth, requireSheet, async (req, res) => {
  try {
    const { date, category, description, amount } = req.body;
    if (!date || !category || amount === undefined || amount === '') {
      return res.status(400).json({ error: 'date, category and amount are required' });
    }
    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: req.session.sheetId,
      range: 'Expenses!A:D',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[date, category, description || '', amount]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

app.put('/api/expenses/:rowIndex', requireAuth, requireSheet, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const { date, category, description, amount } = req.body;
    if (!rowIndex || rowIndex < 2) return res.status(400).json({ error: 'Invalid row index' });

    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: req.session.sheetId,
      range: `Expenses!A${rowIndex}:D${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[date, category, description || '', amount]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

app.delete('/api/expenses/:rowIndex', requireAuth, requireSheet, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex, 10);
    if (!rowIndex || rowIndex < 2) return res.status(400).json({ error: 'Invalid row index' });

    const auth = getOAuthClientFromSession(req);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: req.session.sheetId });
    const expensesSheet = meta.data.sheets.find(s => s.properties.title === 'Expenses');
    const gid = expensesSheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: req.session.sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: gid,
              dimension: 'ROWS',
              startIndex: rowIndex - 1, // 0-indexed, inclusive
              endIndex: rowIndex        // exclusive
            }
          }
        }]
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});
