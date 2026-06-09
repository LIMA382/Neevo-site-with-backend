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




def _lap_seconds_list(laps: pd.DataFrame) -> list[float]:
    values: list[float] = []
    for value in laps.get("LapTime", []):
        seconds = _to_seconds(value)
        if seconds is not None:
            values.append(seconds)
    return values


def _speed_values(laps: pd.DataFrame) -> list[float]:
    values: list[float] = []
    for col in ["SpeedST", "SpeedFL", "SpeedI1", "SpeedI2"]:
        if col not in laps.columns:
            continue
        for value in laps[col].dropna():
            speed = _safe_float(value, 1)
            if speed is not None and speed > 0:
                values.append(speed)
    return values


def _compound_name(value: Any) -> str:
    if value is None or pd.isna(value):
        return "Unknown"
    return str(value).title()


def _driver_profile(laps: pd.DataFrame, driver: str) -> dict[str, Any]:
    lap_times = _lap_seconds_list(laps)
    speeds = _speed_values(laps)

    best_lap = None
    if lap_times:
        best_idx = None
        best_time = 999999.0
        for idx, row in laps.iterrows():
            seconds = _to_seconds(row.get("LapTime"))
            if seconds is not None and seconds < best_time:
                best_time = seconds
                best_idx = idx
        if best_idx is not None:
            row = laps.loc[best_idx]
            best_lap = {
                "lap": _safe_int(row.get("LapNumber")),
                "lapTime": _to_seconds(row.get("LapTime")),
                "compound": _clean_value(row.get("Compound")),
                "tyreLife": _safe_int(row.get("TyreLife")),
            }

    stints: list[dict[str, Any]] = []
    if not laps.empty and "Stint" in laps.columns:
        sorted_laps = laps.sort_values("LapNumber")
        grouped = sorted_laps.groupby("Stint", dropna=True)
        for stint_number, group in grouped:
            if group.empty:
                continue
            first = group.iloc[0]
            last = group.iloc[-1]
            compounds = [x for x in group.get("Compound", pd.Series(dtype=object)).dropna().unique()]
            compound = _compound_name(compounds[0]) if compounds else "Unknown"
            start_lap = _safe_int(first.get("LapNumber"))
            end_lap = _safe_int(last.get("LapNumber"))
            stints.append({
                "stint": _safe_int(stint_number),
                "compound": compound,
                "startLap": start_lap,
                "endLap": end_lap,
                "length": (end_lap - start_lap + 1) if start_lap and end_lap else None,
                "startTyreLife": _safe_int(first.get("TyreLife")),
                "endTyreLife": _safe_int(last.get("TyreLife")),
                "pitLap": start_lap if len(stints) > 0 else None,
            })

    compounds: dict[str, int] = {}
    if "Compound" in laps.columns:
        for value in laps["Compound"].dropna():
            name = _compound_name(value)
            compounds[name] = compounds.get(name, 0) + 1

    return {
        "driver": driver,
        "lapCount": len(lap_times),
        "bestLap": best_lap,
        "averageLap": round(float(np.mean(lap_times)), 3) if lap_times else None,
        "medianLap": round(float(np.median(lap_times)), 3) if lap_times else None,
        "consistency": round(float(np.std(lap_times)), 3) if len(lap_times) > 1 else None,
        "topSpeedMax": round(float(np.max(speeds)), 1) if speeds else None,
        "topSpeedAvg": round(float(np.mean(speeds)), 1) if speeds else None,
        "stints": stints,
        "compounds": [{"compound": k, "laps": v} for k, v in compounds.items()],
    }


def _advantage_label(a_value: Optional[float], b_value: Optional[float], driver_a: str, driver_b: str, lower_is_better: bool = True) -> dict[str, Any]:
    if a_value is None or b_value is None:
        return {"driver": None, "amount": None}
    diff = round(abs(a_value - b_value), 3)
    if abs(a_value - b_value) < 0.001:
        return {"driver": "Even", "amount": 0}
    if lower_is_better:
        return {"driver": driver_a if a_value < b_value else driver_b, "amount": diff}
    return {"driver": driver_a if a_value > b_value else driver_b, "amount": diff}


def _build_observed_insights(profile_a: dict[str, Any], profile_b: dict[str, Any], driver_a: str, driver_b: str, avg_delta: Optional[float]) -> list[dict[str, str]]:
    insights: list[dict[str, str]] = []

    if avg_delta is not None:
        if avg_delta > 0:
            insights.append({"title": f"{driver_a} race pace edge", "body": f"Across shared laps, {driver_a} was ahead by {abs(avg_delta):.3f}s on average. That points to stronger observed race pace in this comparison."})
        elif avg_delta < 0:
            insights.append({"title": f"{driver_b} race pace edge", "body": f"Across shared laps, {driver_b} was ahead by {abs(avg_delta):.3f}s on average. That points to stronger observed race pace in this comparison."})
        else:
            insights.append({"title": "Even race pace", "body": "The average lap-time delta was essentially even across the comparable laps."})

    speed = _advantage_label(profile_a.get("topSpeedAvg"), profile_b.get("topSpeedAvg"), driver_a, driver_b, lower_is_better=False)
    if speed["driver"] and speed["driver"] != "Even" and speed["amount"] is not None:
        insights.append({"title": f"{speed['driver']} straight-line profile", "body": f"The speed-trap data favoured {speed['driver']} by about {speed['amount']:.1f} km/h on average. This suggests a stronger straight-line profile, not necessarily a confirmed setup choice."})

    consistency = _advantage_label(profile_a.get("consistency"), profile_b.get("consistency"), driver_a, driver_b, lower_is_better=True)
    if consistency["driver"] and consistency["driver"] != "Even" and consistency["amount"] is not None:
        insights.append({"title": f"{consistency['driver']} consistency", "body": f"{consistency['driver']} had the smaller lap-time spread by roughly {consistency['amount']:.3f}s. That usually indicates a cleaner or more stable race phase."})

    stints_a = profile_a.get("stints") or []
    stints_b = profile_b.get("stints") or []
    if stints_a or stints_b:
        insights.append({"title": "Tyre strategy context", "body": "Pit and compound changes can explain many delta swings. Treat the lap-time trace together with stint length and tyre age rather than as pure car pace."})

    insights.append({"title": "Important limitation", "body": "These are observed performance differences from timing, tyre and speed data. They do not directly reveal wing level, engine mode, fuel load, ride height or tyre temperature."})
    return insights[:5]

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

        delta = round(time_b - time_a, 3)  # positive = A faster, negative = B faster
        faster = driverA if delta > 0 else driverB if delta < 0 else "TIE"
        if faster == driverA:
            faster_a += 1
        elif faster == driverB:
            faster_b += 1

        item = {
            "lap": lap_number,
            "driverA": {
                "code": driverA,
                "lapTime": time_a,
                "compound": _clean_value(row_a.get("Compound")),
                "tyreLife": _safe_int(row_a.get("TyreLife")),
                "stint": _safe_int(row_a.get("Stint")),
                "sector1": _to_seconds(row_a.get("Sector1Time")),
                "sector2": _to_seconds(row_a.get("Sector2Time")),
                "sector3": _to_seconds(row_a.get("Sector3Time")),
                "speedST": _safe_float(row_a.get("SpeedST"), 1),
                "speedFL": _safe_float(row_a.get("SpeedFL"), 1),
                "position": _safe_int(row_a.get("Position")),
            },
            "driverB": {
                "code": driverB,
                "lapTime": time_b,
                "compound": _clean_value(row_b.get("Compound")),
                "tyreLife": _safe_int(row_b.get("TyreLife")),
                "stint": _safe_int(row_b.get("Stint")),
                "sector1": _to_seconds(row_b.get("Sector1Time")),
                "sector2": _to_seconds(row_b.get("Sector2Time")),
                "sector3": _to_seconds(row_b.get("Sector3Time")),
                "speedST": _safe_float(row_b.get("SpeedST"), 1),
                "speedFL": _safe_float(row_b.get("SpeedFL"), 1),
                "position": _safe_int(row_b.get("Position")),
            },
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

    deltas = [x["delta"] for x in lap_rows]
    avg_delta = round(float(np.mean(deltas)), 3) if deltas else None

    profile_a = _driver_profile(laps_a, driverA)
    profile_b = _driver_profile(laps_b, driverB)

    pace_advantage = _advantage_label(profile_a.get("medianLap"), profile_b.get("medianLap"), driverA, driverB, lower_is_better=True)
    speed_advantage = _advantage_label(profile_a.get("topSpeedAvg"), profile_b.get("topSpeedAvg"), driverA, driverB, lower_is_better=False)
    consistency_advantage = _advantage_label(profile_a.get("consistency"), profile_b.get("consistency"), driverA, driverB, lower_is_better=True)

    return {
        "session": {"year": year, "event": event, "session": session, "sessionName": SESSION_NAMES.get(session, session)},
        "drivers": {"a": driverA, "b": driverB},
        "summary": {
            "lapsCompared": len(lap_rows),
            "fasterA": faster_a,
            "fasterB": faster_b,
            "averageDelta": avg_delta,
            "bestA": best_a,
            "bestB": best_b,
            "closest": closest,
        },
        "profiles": {"a": profile_a, "b": profile_b},
        "carProfile": {
            "paceAdvantage": pace_advantage,
            "speedAdvantage": speed_advantage,
            "consistencyAdvantage": consistency_advantage,
            "speedDeltaAvg": round((profile_a.get("topSpeedAvg") or 0) - (profile_b.get("topSpeedAvg") or 0), 1) if profile_a.get("topSpeedAvg") is not None and profile_b.get("topSpeedAvg") is not None else None,
            "medianDelta": round((profile_b.get("medianLap") or 0) - (profile_a.get("medianLap") or 0), 3) if profile_a.get("medianLap") is not None and profile_b.get("medianLap") is not None else None,
        },
        "insights": _build_observed_insights(profile_a, profile_b, driverA, driverB, avg_delta),
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
