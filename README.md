# 💰 Personal Expense Tracker (Google Sheets backed)

A full-stack web app where users **sign in with Google**, then use their **own Google Sheet** as
the database for a personal expense tracker — add, edit, delete expenses, and see totals by
category and by month.

Built for the CSI Technical Team recruitment task.

---

## ✨ Features

- 🔐 Sign in with Google (OAuth 2.0)
- 📄 Create a brand-new Google Sheet, or pick one you already own
- ➕ Add expenses: date, category, description, amount
- 📋 View all expenses in a table
- ✏️ Edit and 🗑️ delete any expense
- 📊 Totals grouped by category
- 📆 Simple month-wise summary + grand total
- All data lives in **your** Google Sheet — the app itself stores nothing except your
  logged-in session (in server memory)

---

## 🧰 Tools & Technologies Used

| Layer          | Technology |
|----------------|------------|
| Frontend       | HTML5, CSS3, Vanilla JavaScript (no framework, no build step) |
| Backend        | Node.js, Express.js |
| Auth           | Google Identity / OAuth 2.0 (`googleapis` OAuth2 client) |
| Data storage   | Google Sheets API v4 (the sheet **is** the database) |
| File discovery | Google Drive API v3 (`drive.file` scope — only sees files this app touches) |
| Session        | `express-session` (in-memory, cookie-based) |
| Config         | `dotenv` |

No database (SQL/NoSQL) is used on purpose — the Google Sheet itself is the persistent store,
per the assignment requirements.

---

## 🗺️ How it works (workflow)

```
┌──────────┐   1. Click "Sign in       ┌────────────────────┐
│  Browser │ ─────with Google" ──────▶ │ Google OAuth Screen │
└──────────┘                           └──────────┬─────────┘
     ▲                                             │ user approves
     │        3. Redirect to /dashboard.html       ▼
     │  ◀────────────────────────────  ┌────────────────────┐
     │       (session cookie set)      │  Express Server     │
     │                                 │  /auth/google/       │
     │                                 │  callback             │
     │                                 └──────────┬─────────┘
     │                                             │ tokens stored in session
     │  4. Choose: Create new sheet / pick existing / paste URL
     │ ───────────────────────────────────────────▶
     │                                 ┌────────────────────┐
     │                                 │  Google Sheets &    │
     │                                 │  Drive APIs         │
     │                                 └──────────┬─────────┘
     │  5. CRUD on expenses (add/edit/delete)      │
     │ ◀───────────────────────────────────────────┘
     │  6. Totals by category & month computed client-side
     └──────────────────────────────────────────────
```

**Step by step:**

1. User lands on `index.html` and clicks **Sign in with Google**.
2. Server (`/auth/google`) redirects to Google's OAuth consent screen, requesting scopes for
   identity + Sheets + Drive (file-scoped only).
3. Google redirects back to `/auth/google/callback` with an authorization code. The server
   exchanges it for access/refresh tokens, fetches the user's basic profile, and stores both in
   an encrypted session cookie. User is redirected to `dashboard.html`.
4. On the dashboard, the user either:
   - **Creates a new spreadsheet** (`POST /api/sheets/create`) — the server creates a sheet
     titled by the user, adds an `Expenses` tab, and writes the header row
     (`Date | Category | Description | Amount`), or
   - **Picks an existing spreadsheet** from a list (`GET /api/sheets`, powered by the Drive API),
     or pastes a Sheet URL/ID directly.
5. Once a sheet is selected (`POST /api/sheets/select`), the app reads/writes expense rows
   directly through the **Sheets API**:
   - `GET /api/expenses` → reads rows `A2:D`
   - `POST /api/expenses` → appends a new row
   - `PUT /api/expenses/:rowIndex` → overwrites a specific row (edit)
   - `DELETE /api/expenses/:rowIndex` → uses `batchUpdate` → `deleteDimension` to remove the row
6. The frontend computes **totals by category** and a **monthly summary** from the fetched
   expense list and renders them as tables, plus a grand total.

---

## 📁 Project Structure

```
expense-tracker/
├── server.js              # Express server: OAuth + Sheets/Drive API routes
├── package.json
├── .env.example            # Copy to .env and fill in your credentials
├── .gitignore
└── public/
    ├── index.html          # Login screen
    ├── dashboard.html       # Main app UI (sheet picker, expense form, tables)
    ├── dashboard.js         # All frontend logic (fetch calls, rendering, summaries)
    └── style.css
```

---

## ⚙️ Setup Instructions

### 1. Clone & install

```bash
git clone <your-repo-url>
cd expense-tracker
npm install
```

### 2. Google Cloud setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project
   (or use an existing one).
2. Go to **APIs & Services → Library** and enable:
   - **Google Sheets API**
   - **Google Drive API**
3. Go to **APIs & Services → OAuth consent screen**:
   - User type: External (or Internal if using a Workspace account)
   - Add your email as a **Test user** (required while the app is in "Testing" status)
   - Scopes: you can leave default; the app requests scopes at runtime
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - Copy the generated **Client ID** and **Client Secret**

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=any-long-random-string
PORT=3000
```

### 4. Run the app

```bash
npm start
```

Visit **http://localhost:3000** and sign in with Google.

---

## 🔒 Scopes requested & why

| Scope | Why |
|---|---|
| `openid`, `email`, `profile` | Know who's signed in, show name/avatar |
| `https://www.googleapis.com/auth/spreadsheets` | Read/write expense rows |
| `https://www.googleapis.com/auth/drive.file` | List/create **only** spreadsheets this app creates or that the user explicitly opens — not full Drive access |

---

## 🚀 Possible future improvements

- Persist refresh tokens in a real database so users don't need to re-consent after restarts
- Add charts (e.g. Chart.js) for category/monthly breakdowns
- Filter/search expenses by date range or category
- CSV export
- Deploy to Render/Railway/Vercel with HTTPS + production session store

---

## 👤 Author

Built by Disha for the CSI Technical Team recruitment task.
