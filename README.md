# 🎙️ AI Meeting Assistant — Enterprise Edition

An internal enterprise tool that **records or uploads meetings**, automatically **transcribes**, **summarizes**, and generates **trackable action items** — all stored in a free Google Sheets database. Deployable as a **PWA** (Progressive Web App) so employees can install it directly on their phones.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React Frontend (Vite + PWA)                                │
│  - Password-less login (Email or Phone)                     │
│  - Live mic recording or file upload                        │
│  - Real-time progress tracking                              │
│  - Executive Summary + SRT Transcript viewer                │
│  - Editable Action Items (saved to Sheets)                  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────────┐
│  FastAPI Backend (Python)                                   │
│  - Receives audio upload                                    │
│  - Compresses audio via FFmpeg                              │
│  - Transcribes via AssemblyAI (speaker diarization)        │
│  - Summarizes + extracts action items via Gemini AI         │
│  - Gemini model fallback chain (5 models)                  │
│  - Updates progress in Google Sheets in real-time          │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP (Google Apps Script REST API)
┌────────────────────────▼────────────────────────────────────┐
│  Google Sheets Database (Free, No Limits)                  │
│  - Users tab: Employee registry                             │
│  - Meetings tab: Full meeting history per user             │
│  - Managed by Google Apps Script Web App                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite, TailwindCSS |
| **Backend** | FastAPI (Python), Uvicorn |
| **AI Transcription** | AssemblyAI (speaker diarization + SRT) |
| **AI Summarization** | Google Gemini (2.5-flash → fallback chain) |
| **Database** | Google Sheets via Google Apps Script |
| **Auth** | Password-less (Email/Phone stored in localStorage) |
| **Mobile** | PWA — installable on Android & iOS |

---

## 📁 Project Structure

```
├── backend/
│   ├── main.py              # FastAPI server — all processing logic
│   ├── APPS_SCRIPT.js       # Google Apps Script code (deploy to Google Cloud)
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # 🔒 Secret keys (NOT in GitHub)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main dashboard UI
│   │   └── Auth.jsx         # Login & Registration UI
│   ├── public/
│   │   ├── manifest.json    # PWA manifest
│   │   ├── sw.js            # Service Worker (offline support)
│   │   ├── icon-192.png     # App icon (home screen)
│   │   └── icon-512.png     # App icon (splash screen)
│   ├── index.html           # PWA-ready HTML shell
│   └── .env                 # 🔒 Frontend env vars (NOT in GitHub)
│
└── README.md
```

---

## ⚙️ Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/ai-meeting-assistant.git
cd ai-meeting-assistant
```

### 2. Set up Google Sheets Database
1. Create a new Google Sheet named **"AI Meeting Assistant Database"**
2. Create two tabs: **`Users`** and **`Meetings`**
3. **Users tab headers** (Row 1): `User ID | Name | Department | Registered At`
4. **Meetings tab headers** (Row 1): `Meeting ID | User ID | Title | Status | Progress | Summary | Action Items | Transcript | Created At`
5. Go to **Extensions → Apps Script**
6. Copy the contents of `backend/APPS_SCRIPT.js` into `Code.gs`
7. Click **Deploy → New Deployment → Web App**
8. Set access to **"Anyone"** → Deploy
9. Copy the **Web App URL**

### 3. Set up Backend
```bash
cd backend
pip install -r requirements.txt
```

Create `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

Run the backend:
```bash
uvicorn main:app --reload
```

### 4. Set up Frontend
```bash
cd frontend
npm install
```

Create `frontend/.env`:
```env
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
VITE_FASTAPI_URL=http://localhost:8000
```

Run the frontend:
```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🌐 Production Deployment (100% Free)

### Backend → Render.com (Free)
1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect your GitHub repo → select the `backend` folder
3. Settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add Environment Variables on Render dashboard
5. Deploy → copy your URL: `https://your-app.onrender.com`

### Frontend → Vercel.com (Free)
1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Connect GitHub → select the `frontend` folder
3. Add Environment Variables:
   ```
   VITE_APPS_SCRIPT_URL = your_apps_script_url
   VITE_FASTAPI_URL = https://your-app.onrender.com
   ```
4. Deploy → share your URL with employees!

### Keep Backend Alive → UptimeRobot (Free)
Render free tier sleeps after 15 minutes of inactivity. Fix it for free:
1. Go to [uptimerobot.com](https://uptimerobot.com) → Sign up free
2. **Add New Monitor → HTTP(s)**
3. URL: `https://your-app.onrender.com`
4. Interval: **Every 5 minutes**
5. Save → your backend never sleeps again ✅

---

## 📱 Installing as a Mobile App (PWA)

**Android (Chrome):**
1. Open the app URL in Chrome
2. Tap 3-dot menu → **"Add to Home screen"** → Install

**iPhone (Safari):**
1. Open the app URL in Safari
2. Tap Share icon → **"Add to Home Screen"** → Add

---

## 🔑 Environment Variables Reference

### Backend (`backend/.env`)
| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key |
| `APPS_SCRIPT_URL` | Google Apps Script Web App URL |

### Frontend (`frontend/.env`)
| Variable | Description |
|---|---|
| `VITE_APPS_SCRIPT_URL` | Google Apps Script Web App URL |
| `VITE_FASTAPI_URL` | Backend URL (localhost or Render) |

---

## 🤝 Internal Use Only

This application is designed for **internal company use**. It uses a simplified password-less authentication system (Email/Phone ID only). Do not expose this to the public internet without adding proper authentication.
