# RaceScope backend

FastAPI + FastF1 backend for dynamic F1 data.

## Render Web Service settings

- Root directory: `backend`
- Runtime: Python
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Optional environment variables:

- `CORS_ORIGINS`: your frontend URL, e.g. `https://f1-site-new.onrender.com`
- `FASTF1_CACHE_DIR`: cache path. Default is `/tmp/racescope-fastf1-cache`.

First requests can be slow because FastF1 downloads and caches session data.
