# RaceScope full data starter

This version separates RaceScope into two Render services:

1. `backend/` — Python FastAPI + FastF1 API
2. `frontend/` — React/Vite static site that calls the API

## Deploy order

### 1. Backend on Render

Create a new **Web Service**.

Settings:

- Root directory: `backend`
- Runtime: Python
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

After deploy, copy the backend URL.

### 2. Frontend on Render

Create a new **Static Site**.

Settings:

- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Publish directory: `dist`

Environment variable:

- `VITE_API_BASE_URL` = your backend URL

## Notes

FastF1 downloads real F1 timing/telemetry data on demand. First requests can take time while data is cached. Start with recent completed sessions such as 2024 British Grand Prix Race or Qualifying.
