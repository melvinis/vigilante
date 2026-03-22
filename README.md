# Vigilante

On-chain AML wallet screening platform for DFSA compliance.  
Supports **BTC · ETH/EVM · TRX (TRON) · SOL**

Built with React + Vite · Supabase (Postgres + Auth) · Deployed on Vercel

---

## First-time setup

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/vigilante.git
cd vigilante
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```
Edit `.env.local` with your Supabase credentials:
```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### 3. Run locally
```bash
npm run dev
# Opens at http://localhost:5173
```

---

## Deploy to Vercel via GitHub

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "feat: initial vigilante deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vigilante.git
git push -u origin main
```

### Step 2 — Import into Vercel
1. Go to vercel.com → Add New Project
2. Import Git Repository → select vigilante
3. Framework: Vite (auto-detected)
4. Add environment variables before deploying:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
5. Click Deploy

Your app is live at https://vigilante-xxx.vercel.app
Every git push to main triggers an automatic redeploy.

### Step 3 — Set Supabase redirect URL
Supabase → Authentication → URL Configuration

Site URL:       https://vigilante-xxx.vercel.app
Redirect URLs:  https://vigilante-xxx.vercel.app
                https://vigilante-xxx.vercel.app/**

---

## Inviting team members

1. Supabase Dashboard → Authentication → Users → Invite User
2. Enter their email and send the invite
3. They click the link → lands on Vigilante → prompted to set password
4. Done — they can log in at your Vercel URL

---

## Ongoing development workflow

```bash
npm run dev           # test locally at localhost:5173

git add .
git commit -m "your message"
git push              # Vercel auto-deploys in ~30 seconds
```

---

## Environment variables

| Variable                  | Where to find                                    |
|---------------------------|--------------------------------------------------|
| VITE_SUPABASE_URL         | Supabase → Settings → API → Project URL          |
| VITE_SUPABASE_ANON_KEY    | Supabase → Settings → API → anon/public key      |

Never commit .env.local to Git — it is in .gitignore.
Set production values in Vercel → Project → Settings → Environment Variables.

---

## Database schema

Run supabase/schema.sql in your Supabase SQL Editor before first use.

Tables:
- wallet_registry  — one row per unique wallet, latest state
- wallet_scans     — immutable scan record per scan event
- scan_changes     — detected changes between consecutive scans
