from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Optional

import fastf1
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

CACHE_DIR = os.getenv("FASTF1_CACHE_DIR", "/tmp/racescope-fastf1-cache")
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

app = FastAPI(title="RaceScope API", version="0.1.0")

allowed_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_NAMES = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "Q": "Qualifying",
    "R": "Race",
}


def _clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
        return None
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, pd.Timedelta):
        return value.total_seconds()
    return value


def _to_seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timedelta):
        return round(float(value.total_seconds()), 3)
    try:
        return round(float(value), 3)
    except Exception:
        return None


def _safe_float(value: Any, digits: int = 3) -> Optional[float]:
    try:
        if value is None or pd.isna(value):
            return None
        return round(float(value), digits)
    except Exception:
        return None


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None or pd.isna(value):
            return None
        return int(value)
    except Exception:
        return None


@lru_cache(maxsize=64)
def _load_session(year: int, event: str, session_code: str, telemetry: bool = False):
    try:
        session = fastf1.get_session(year, event, session_code)
        session.load(laps=True, telemetry=telemetry, weather=False, messages=True)
        return session
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load session: {exc}") from exc


def _event_name_from_row(row: pd.Series) -> str:
    return str(row.get("EventName") or row.get("OfficialEventName") or "Unknown")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "cacheDir": CACHE_DIR}


@app.get("/api/seasons")
def seasons() -> dict[str, Any]:
    # FastF1 has more historic data, but modern hybrid-era data is the useful default for this app.
    return {"seasons": list(range(2018, 2027))}


@app.get("/api/events")
def events(year: int = Query(..., ge=2018, le=2030)) -> dict[str, Any]:
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load event schedule: {exc}") from exc

    records: list[dict[str, Any]] = []
    for _, row in schedule.iterrows():
        event_name = _event_name_from_row(row)
        if event_name.lower() == "unknown":
            continue
        sessions = []
        for key in ["Session1", "Session2", "Session3", "Session4", "Session5"]:
            name = row.get(key)
            if isinstance(name, str) and name and name.lower() != "nan":
                code = next((k for k, v in SESSION_NAMES.items() if v == name), None)
                sessions.append({"code": code or name, "name": name})
        records.append(
            {
                "round": _safe_int(row.get("RoundNumber")),
                "name": event_name,
                "officialName": _clean_value(row.get("OfficialEventName")),
                "country": _clean_value(row.get("Country")),
                "location": _clean_value(row.get("Location")),
                "date": _clean_value(row.get("EventDate")),
                "sessions": sessions,
            }
        )
    return {"year": year, "events": records}


@app.get("/api/drivers")
def drivers(year: int, event: str, session: str = Query("R")) -> dict[str, Any]:
    loaded = _load_session(year, event, session, telemetry=False)
    drivers_out: list[dict[str, Any]] = []
    try:
        results = loaded.results
        for _, row in results.iterrows():
            code = row.get("Abbreviation") or row.get("BroadcastName") or row.get("DriverNumber")
            if not code:
                continue
            drivers_out.append(
                {
                    "code": str(code),
                    "number": str(row.get("DriverNumber")) if not pd.isna(row.get("DriverNumber")) else None,
                    "name": str(row.get("FullName")) if not pd.isna(row.get("FullName")) else str(code),
                    "team": str(row.get("TeamName")) if not pd.isna(row.get("TeamName")) else None,
                    "teamColor": str(row.get("TeamColor")) if not pd.isna(row.get("TeamColor")) else None,
                }
            )
    except Exception:
        codes = sorted(set(str(x) for x in loaded.laps["Driver"].dropna().unique()))
        drivers_out = [{"code": code, "name": code, "team": None, "teamColor": None} for code in codes]
    return {"year": year, "event": event, "session": session, "drivers": drivers_out}


def _driver_laps(loaded, driver: str) -> pd.DataFrame:
    laps = loaded.laps
    driver_laps = laps[laps["Driver"] == driver].copy()
    if driver_laps.empty:
        raise HTTPException(status_code=404, detail=f"No laps found for driver {driver}")
    driver_laps = driver_laps[driver_laps["LapTime"].notna()]
    return driver_laps


@app.get("/api/compare/all-laps")
def compare_all_laps(year: int, event: str, session: str, driverA: str, driverB: str) -> dict[str, Any]:
    loaded = _load_session(year, event, session, telemetry=False)
    laps_a = _driver_laps(loaded, driverA)
    laps_b = _driver_laps(loaded, driverB)

    by_lap_a = {int(row["LapNumber"]): row for _, row in laps_a.iterrows() if not pd.isna(row.get("LapNumber"))}
    by_lap_b = {int(row["LapNumber"]): row for _, row in laps_b.iterrows() if not pd.isna(row.get("LapNumber"))}
    common_laps = sorted(set(by_lap_a).intersection(by_lap_b))

    lap_rows: list[dict[str, Any]] = []
    faster_a = 0
    faster_b = 0
    best_a = None
    best_b = None
    closest = None

    for lap_number in common_laps:
        row_a = by_lap_a[lap_number]
        row_b = by_lap_b[lap_number]
        time_a = _to_seconds(row_a.get("LapTime"))
        time_b = _to_seconds(row_b.get("LapTime"))
        if time_a is None or time_b is None:
            continue
        delta = round(time_b - time_a, 3)  # negative = B faster, positive = A faster
        faster = driverA if delta > 0 else driverB if delta < 0 else "TIE"
        if faster == driverA:
            faster_a += 1
        elif faster == driverB:
            faster_b += 1
        item = {
            "lap": lap_number,
            "driverA": {"code": driverA, "lapTime": time_a, "compound": _clean_value(row_a.get("Compound")), "tyreLife": _safe_int(row_a.get("TyreLife")), "stint": _safe_int(row_a.get("Stint"))},
            "driverB": {"code": driverB, "lapTime": time_b, "compound": _clean_value(row_b.get("Compound")), "tyreLife": _safe_int(row_b.get("TyreLife")), "stint": _safe_int(row_b.get("Stint"))},
            "delta": delta,
            "faster": faster,
        }
        lap_rows.append(item)
        if best_a is None or delta > best_a["delta"]:
            best_a = item
        if best_b is None or delta < best_b["delta"]:
            best_b = item
        if closest is None or abs(delta) < abs(closest["delta"]):
            closest = item

    avg_delta = round(float(np.mean([x["delta"] for x in lap_rows])), 3) if lap_rows else None
    return {
        "session": {"year": year, "event": event, "session": session, "sessionName": SESSION_NAMES.get(session, session)},
        "drivers": {"a": driverA, "b": driverB},
        "summary": {"lapsCompared": len(lap_rows), "fasterA": faster_a, "fasterB": faster_b, "averageDelta": avg_delta, "bestA": best_a, "bestB": best_b, "closest": closest},
        "laps": lap_rows,
    }


def _car_data_for_lap(lap) -> pd.DataFrame:
    try:
        tel = lap.get_car_data().add_distance()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load car telemetry: {exc}") from exc
    if tel.empty:
        raise HTTPException(status_code=404, detail="Telemetry is empty for selected lap")
    return tel


def _sample_telemetry(tel: pd.DataFrame, n: int = 180) -> dict[str, list[Any]]:
    tel = tel.dropna(subset=["Distance"]).copy()
    if tel.empty:
        return {"distance": [], "speed": [], "throttle": [], "brake": [], "gear": [], "drs": [], "time": []}
    idx = np.linspace(0, len(tel) - 1, min(n, len(tel))).astype(int)
    sampled = tel.iloc[idx]
    time_col = sampled["Time"].dt.total_seconds() if hasattr(sampled["Time"], "dt") else sampled["Time"]
    return {
        "distance": [_safe_float(x, 1) for x in sampled["Distance"]],
        "speed": [_safe_float(x, 1) for x in sampled.get("Speed", [])],
        "throttle": [_safe_float(x, 1) for x in sampled.get("Throttle", [])],
        "brake": [bool(x) for x in sampled.get("Brake", [])],
        "gear": [_safe_int(x) for x in sampled.get("nGear", [])],
        "drs": [_safe_int(x) for x in sampled.get("DRS", [])],
        "time": [_safe_float(x, 3) for x in time_col],
    }


def _delta_trace(tel_a: pd.DataFrame, tel_b: pd.DataFrame, n: int = 180) -> dict[str, list[Any]]:
    ta = tel_a.dropna(subset=["Distance", "Time"]).copy()
    tb = tel_b.dropna(subset=["Distance", "Time"]).copy()
    if ta.empty or tb.empty:
        return {"distance": [], "delta": []}
    max_distance = min(float(ta["Distance"].max()), float(tb["Distance"].max()))
    grid = np.linspace(0, max_distance, n)
    t_a = ta["Time"].dt.total_seconds().to_numpy()
    t_b = tb["Time"].dt.total_seconds().to_numpy()
    d_a = ta["Distance"].to_numpy(dtype=float)
    d_b = tb["Distance"].to_numpy(dtype=float)
    time_a = np.interp(grid, d_a, t_a)
    time_b = np.interp(grid, d_b, t_b)
    delta = time_b - time_a
    return {"distance": [round(float(x), 1) for x in grid], "delta": [round(float(x), 3) for x in delta]}


def _track_points(lap, n: int = 240) -> list[dict[str, float]]:
    try:
        pos = lap.get_pos_data()
    except Exception:
        return []
    if pos.empty or "X" not in pos or "Y" not in pos:
        return []
    idx = np.linspace(0, len(pos) - 1, min(n, len(pos))).astype(int)
    p = pos.iloc[idx]
    x = p["X"].to_numpy(dtype=float)
    y = p["Y"].to_numpy(dtype=float)
    x_range = max(float(x.max() - x.min()), 1.0)
    y_range = max(float(y.max() - y.min()), 1.0)
    xs = ((x - x.min()) / x_range) * 100
    ys = ((y - y.min()) / y_range) * 100
    return [{"x": round(float(a), 2), "y": round(float(b), 2)} for a, b in zip(xs, ys)]


def _sector_seconds(row: pd.Series) -> dict[str, Optional[float]]:
    return {
        "s1": _to_seconds(row.get("Sector1Time")),
        "s2": _to_seconds(row.get("Sector2Time")),
        "s3": _to_seconds(row.get("Sector3Time")),
    }


def _insights(driver_a: str, driver_b: str, row_a: pd.Series, row_b: pd.Series, delta_info: dict[str, list[Any]]) -> list[dict[str, str]]:
    insights: list[dict[str, str]] = []
    sectors_a = _sector_seconds(row_a)
    sectors_b = _sector_seconds(row_b)
    for key, label in [("s1", "Sector 1"), ("s2", "Sector 2"), ("s3", "Sector 3")]:
        if sectors_a[key] is None or sectors_b[key] is None:
            continue
        diff = round(sectors_b[key] - sectors_a[key], 3)
        if abs(diff) < 0.001:
            continue
        winner = driver_a if diff > 0 else driver_b
        insights.append({"title": f"{label} · {winner} {abs(diff):.3f}s", "body": "Largest sector-side contribution in this lap comparison."})
    if delta_info.get("delta"):
        arr = np.array(delta_info["delta"], dtype=float)
        idx = int(np.argmax(np.abs(arr)))
        dist = delta_info["distance"][idx]
        winner = driver_a if arr[idx] > 0 else driver_b
        insights.append({"title": f"Peak advantage · {winner}", "body": f"Largest cumulative gap appears around {dist:.0f} m into the lap."})
    return insights[:3]


@app.get("/api/compare/lap")
def compare_lap(year: int, event: str, session: str, driverA: str, driverB: str, lap: int) -> dict[str, Any]:
    loaded = _load_session(year, event, session, telemetry=True)
    laps_a = _driver_laps(loaded, driverA)
    laps_b = _driver_laps(loaded, driverB)
    match_a = laps_a[laps_a["LapNumber"] == lap]
    match_b = laps_b[laps_b["LapNumber"] == lap]
    if match_a.empty or match_b.empty:
        raise HTTPException(status_code=404, detail="Selected lap is not available for both drivers")
    row_a = match_a.iloc[0]
    row_b = match_b.iloc[0]
    tel_a = _car_data_for_lap(row_a)
    tel_b = _car_data_for_lap(row_b)
    samples_a = _sample_telemetry(tel_a)
    samples_b = _sample_telemetry(tel_b)
    delta = _delta_trace(tel_a, tel_b)
    lap_time_a = _to_seconds(row_a.get("LapTime"))
    lap_time_b = _to_seconds(row_b.get("LapTime"))
    finish_delta = round((lap_time_b or 0) - (lap_time_a or 0), 3) if lap_time_a is not None and lap_time_b is not None else None

    return {
        "session": {"year": year, "event": event, "session": session, "sessionName": SESSION_NAMES.get(session, session)},
        "lap": lap,
        "drivers": {"a": driverA, "b": driverB},
        "metrics": {
            "finishDelta": finish_delta,
            "topSpeedA": _safe_float(tel_a.get("Speed", pd.Series(dtype=float)).max(), 1),
            "topSpeedB": _safe_float(tel_b.get("Speed", pd.Series(dtype=float)).max(), 1),
            "minSpeedA": _safe_float(tel_a.get("Speed", pd.Series(dtype=float)).min(), 1),
            "minSpeedB": _safe_float(tel_b.get("Speed", pd.Series(dtype=float)).min(), 1),
        },
        "lapTimes": {"a": lap_time_a, "b": lap_time_b},
        "sectors": {"a": _sector_seconds(row_a), "b": _sector_seconds(row_b)},
        "telemetry": {"a": samples_a, "b": samples_b, "delta": delta},
        "track": {"points": _track_points(row_a), "advantageZones": []},
        "insights": _insights(driverA, driverB, row_a, row_b, delta),
    }
