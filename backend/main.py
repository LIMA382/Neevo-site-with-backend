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

app = FastAPI(title="RaceScope API", version="0.2.0")

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

FALLBACK_TEAM_COLORS = {
    "Red Bull Racing": "#3671C6",
    "Ferrari": "#E80020",
    "Mercedes": "#27F4D2",
    "McLaren": "#FF8000",
    "Aston Martin": "#229971",
    "Alpine": "#FF87BC",
    "Williams": "#64C4FF",
    "RB": "#6692FF",
    "Kick Sauber": "#52E252",
    "Haas F1 Team": "#B6BABD",
    "Racing Bulls": "#6692FF",
    "Haas": "#B6BABD",
    "Sauber": "#52E252",
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


def _normalize_color(value: Any, fallback: str = "#1D1D1F") -> str:
    if value is None or pd.isna(value):
        return fallback
    color = str(value).strip()
    if not color:
        return fallback
    if not color.startswith("#"):
        color = f"#{color}"
    if len(color) == 7:
        return color
    return fallback


@lru_cache(maxsize=32)
def _load_session(year: int, event: str, session_code: str, telemetry: bool = False):
    try:
        session = fastf1.get_session(year, event, session_code)
        session.load(laps=True, telemetry=telemetry, weather=False, messages=False)
        return session
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not load session: {exc}") from exc


def _event_name_from_row(row: pd.Series) -> str:
    return str(row.get("EventName") or row.get("OfficialEventName") or "Unknown")


def _team_lookup(loaded) -> dict[str, dict[str, Any]]:
    teams: dict[str, dict[str, Any]] = {}
    results = getattr(loaded, "results", None)
    if results is not None and not results.empty:
        for _, row in results.iterrows():
            team = row.get("TeamName")
            if team is None or pd.isna(team) or str(team).strip() == "":
                continue
            name = str(team).strip()
            color = _normalize_color(row.get("TeamColor"), FALLBACK_TEAM_COLORS.get(name, "#1D1D1F"))
            code = row.get("Abbreviation")
            driver_code = None if code is None or pd.isna(code) else str(code).strip()
            if name not in teams:
                teams[name] = {"name": name, "color": color, "drivers": []}
            if driver_code and driver_code not in teams[name]["drivers"]:
                teams[name]["drivers"].append(driver_code)
    return teams


def _driver_lookup(loaded) -> dict[str, dict[str, Any]]:
    drivers: dict[str, dict[str, Any]] = {}
    results = getattr(loaded, "results", None)
    if results is not None and not results.empty:
        for _, row in results.iterrows():
            code = row.get("Abbreviation") or row.get("BroadcastName") or row.get("DriverNumber")
            if code is None or pd.isna(code) or str(code).strip() == "":
                continue
            code = str(code).strip()
            team = row.get("TeamName")
            team_name = None if team is None or pd.isna(team) else str(team).strip()
            color = _normalize_color(row.get("TeamColor"), FALLBACK_TEAM_COLORS.get(team_name or "", "#1D1D1F"))
            drivers[code] = {
                "code": code,
                "number": str(row.get("DriverNumber")) if row.get("DriverNumber") is not None and not pd.isna(row.get("DriverNumber")) else None,
                "name": str(row.get("FullName")) if row.get("FullName") is not None and not pd.isna(row.get("FullName")) else code,
                "team": team_name,
                "teamColor": color,
            }
    return drivers


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "cacheDir": CACHE_DIR}


@app.get("/api/seasons")
def seasons() -> dict[str, Any]:
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
        records.append({
            "round": _safe_int(row.get("RoundNumber")),
            "name": event_name,
            "officialName": _clean_value(row.get("OfficialEventName")),
            "country": _clean_value(row.get("Country")),
            "location": _clean_value(row.get("Location")),
            "date": _clean_value(row.get("EventDate")),
            "sessions": sessions,
        })
    return {"year": year, "events": records}


@app.get("/api/drivers")
def drivers(year: int, event: str, session: str = Query("R")) -> dict[str, Any]:
    loaded = _load_session(year, event, session, telemetry=False)
    driver_map = _driver_lookup(loaded)
    team_map = _team_lookup(loaded)

    if not driver_map:
        try:
            laps = loaded.laps
            codes = sorted(set(str(x) for x in laps["Driver"].dropna().unique())) if "Driver" in laps.columns else []
            driver_map = {code: {"code": code, "number": None, "name": code, "team": None, "teamColor": "#1D1D1F"} for code in codes}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Could not build driver list: {exc}") from exc

    drivers_out = sorted(driver_map.values(), key=lambda x: x.get("code") or "")
    teams_out = sorted(team_map.values(), key=lambda x: x.get("name") or "")

    return {"year": year, "event": event, "session": session, "drivers": drivers_out, "teams": teams_out}


def _driver_laps(loaded, driver: str) -> pd.DataFrame:
    laps = loaded.laps
    driver_laps = laps[laps["Driver"] == driver].copy()
    if driver_laps.empty:
        raise HTTPException(status_code=404, detail=f"No laps found for driver {driver}")
    return driver_laps[driver_laps["LapTime"].notna()]


def _team_laps(loaded, team: str) -> pd.DataFrame:
    laps = loaded.laps.copy()
    if "Team" in laps.columns:
        team_laps = laps[laps["Team"] == team].copy()
    else:
        team_meta = _team_lookup(loaded).get(team, {})
        codes = team_meta.get("drivers") or []
        team_laps = laps[laps["Driver"].isin(codes)].copy()
    if team_laps.empty:
        raise HTTPException(status_code=404, detail=f"No laps found for team {team}")
    return team_laps[team_laps["LapTime"].notna()]


def _best_row_by_lap(laps: pd.DataFrame) -> dict[int, pd.Series]:
    out: dict[int, pd.Series] = {}
    if laps.empty:
        return out
    for lap_number, group in laps.groupby("LapNumber"):
        if pd.isna(lap_number):
            continue
        best_idx = None
        best_time = None
        for idx, row in group.iterrows():
            seconds = _to_seconds(row.get("LapTime"))
            if seconds is None:
                continue
            if best_time is None or seconds < best_time:
                best_time = seconds
                best_idx = idx
        if best_idx is not None:
            out[int(lap_number)] = laps.loc[best_idx]
    return out


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


def _representative_stints(laps: pd.DataFrame, mode: str) -> list[dict[str, Any]]:
    stints: list[dict[str, Any]] = []
    if laps.empty:
        return stints
    sorted_laps = laps.sort_values("LapNumber")

    if mode == "teams":
        rows = list(_best_row_by_lap(sorted_laps).values())
        sorted_laps = pd.DataFrame(rows) if rows else sorted_laps

    key_cols = ["Driver", "Stint"] if mode == "drivers" and "Driver" in sorted_laps.columns and "Stint" in sorted_laps.columns else ["Stint"] if "Stint" in sorted_laps.columns else []
    if not key_cols:
        return stints

    for key, group in sorted_laps.groupby(key_cols, dropna=True):
        if group.empty:
            continue
        first = group.iloc[0]
        last = group.iloc[-1]
        compounds = [x for x in group.get("Compound", pd.Series(dtype=object)).dropna().unique()]
        compound = _compound_name(compounds[0]) if compounds else "Unknown"
        start_lap = _safe_int(first.get("LapNumber"))
        end_lap = _safe_int(last.get("LapNumber"))
        driver = _clean_value(first.get("Driver"))
        stints.append({
            "driver": driver,
            "stint": _safe_int(first.get("Stint")),
            "compound": compound,
            "startLap": start_lap,
            "endLap": end_lap,
            "length": (end_lap - start_lap + 1) if start_lap and end_lap else None,
            "startTyreLife": _safe_int(first.get("TyreLife")),
            "endTyreLife": _safe_int(last.get("TyreLife")),
            "pitLap": start_lap if len(stints) > 0 else None,
        })
    return sorted(stints, key=lambda x: (x.get("startLap") or 0, x.get("driver") or ""))


def _driver_profile(laps: pd.DataFrame, label: str, mode: str = "drivers") -> dict[str, Any]:
    if mode == "teams":
        representative = pd.DataFrame(list(_best_row_by_lap(laps).values())) if not laps.empty else laps
    else:
        representative = laps

    lap_times = _lap_seconds_list(representative)
    speeds = _speed_values(representative)

    best_lap = None
    if lap_times:
        best_idx = None
        best_time = 999999.0
        for idx, row in representative.iterrows():
            seconds = _to_seconds(row.get("LapTime"))
            if seconds is not None and seconds < best_time:
                best_time = seconds
                best_idx = idx
        if best_idx is not None:
            row = representative.loc[best_idx]
            best_lap = {"lap": _safe_int(row.get("LapNumber")), "lapTime": _to_seconds(row.get("LapTime")), "compound": _clean_value(row.get("Compound")), "tyreLife": _safe_int(row.get("TyreLife")), "driver": _clean_value(row.get("Driver"))}

    compounds: dict[str, int] = {}
    if "Compound" in representative.columns:
        for value in representative["Compound"].dropna():
            name = _compound_name(value)
            compounds[name] = compounds.get(name, 0) + 1

    return {
        "driver": label,
        "lapCount": len(lap_times),
        "bestLap": best_lap,
        "averageLap": round(float(np.mean(lap_times)), 3) if lap_times else None,
        "medianLap": round(float(np.median(lap_times)), 3) if lap_times else None,
        "consistency": round(float(np.std(lap_times)), 3) if len(lap_times) > 1 else None,
        "topSpeedMax": round(float(np.max(speeds)), 1) if speeds else None,
        "topSpeedAvg": round(float(np.mean(speeds)), 1) if speeds else None,
        "stints": _representative_stints(laps, mode),
        "compounds": [{"compound": k, "laps": v} for k, v in compounds.items()],
    }


def _advantage_label(a_value: Optional[float], b_value: Optional[float], label_a: str, label_b: str, lower_is_better: bool = True) -> dict[str, Any]:
    if a_value is None or b_value is None:
        return {"driver": None, "amount": None}
    diff = round(abs(a_value - b_value), 3)
    if abs(a_value - b_value) < 0.001:
        return {"driver": "Even", "amount": 0}
    if lower_is_better:
        return {"driver": label_a if a_value < b_value else label_b, "amount": diff}
    return {"driver": label_a if a_value > b_value else label_b, "amount": diff}


def _build_observed_insights(profile_a: dict[str, Any], profile_b: dict[str, Any], label_a: str, label_b: str, avg_delta: Optional[float], mode: str) -> list[dict[str, str]]:
    subject = "team" if mode == "teams" else "driver"
    insights: list[dict[str, str]] = []
    if avg_delta is not None:
        if avg_delta > 0:
            insights.append({"title": f"{label_a} pace edge", "body": f"Across shared laps, {label_a} was ahead by {abs(avg_delta):.3f}s on average. That points to stronger observed {subject} pace in this comparison."})
        elif avg_delta < 0:
            insights.append({"title": f"{label_b} pace edge", "body": f"Across shared laps, {label_b} was ahead by {abs(avg_delta):.3f}s on average. That points to stronger observed {subject} pace in this comparison."})
        else:
            insights.append({"title": "Even race pace", "body": "The average lap-time delta was essentially even across the comparable laps."})

    speed = _advantage_label(profile_a.get("topSpeedAvg"), profile_b.get("topSpeedAvg"), label_a, label_b, lower_is_better=False)
    if speed["driver"] and speed["driver"] != "Even" and speed["amount"] is not None:
        insights.append({"title": f"{speed['driver']} straight-line profile", "body": f"Speed-trap data favoured {speed['driver']} by about {speed['amount']:.1f} km/h on average. This suggests a stronger straight-line profile, not a confirmed setup choice."})

    consistency = _advantage_label(profile_a.get("consistency"), profile_b.get("consistency"), label_a, label_b, lower_is_better=True)
    if consistency["driver"] and consistency["driver"] != "Even" and consistency["amount"] is not None:
        insights.append({"title": f"{consistency['driver']} consistency", "body": f"{consistency['driver']} had the smaller lap-time spread by roughly {consistency['amount']:.3f}s. That usually indicates a cleaner or more stable race phase."})

    insights.append({"title": "Tyre and pit context", "body": "Pit timing, compound choice and tyre age can explain many delta swings. Compare the lap-time trend together with the strategy timeline."})
    insights.append({"title": "Important limitation", "body": "These are observed performance differences from timing, tyre and speed data. They do not directly reveal wing level, engine mode, fuel load, ride height or tyre temperature."})
    return insights[:5]


def _entity_meta(loaded, label: str, mode: str) -> dict[str, Any]:
    if mode == "teams":
        team = _team_lookup(loaded).get(label)
        return {"label": label, "name": label, "color": team.get("color", FALLBACK_TEAM_COLORS.get(label, "#1D1D1F")) if team else FALLBACK_TEAM_COLORS.get(label, "#1D1D1F"), "drivers": team.get("drivers", []) if team else []}
    driver = _driver_lookup(loaded).get(label, {})
    return {"label": label, "name": driver.get("name", label), "color": driver.get("teamColor", "#1D1D1F"), "team": driver.get("team")}


def _row_payload(row: pd.Series, label: str) -> dict[str, Any]:
    return {
        "code": label,
        "driver": _clean_value(row.get("Driver")),
        "team": _clean_value(row.get("Team")),
        "lapTime": _to_seconds(row.get("LapTime")),
        "compound": _clean_value(row.get("Compound")),
        "tyreLife": _safe_int(row.get("TyreLife")),
        "stint": _safe_int(row.get("Stint")),
        "sector1": _to_seconds(row.get("Sector1Time")),
        "sector2": _to_seconds(row.get("Sector2Time")),
        "sector3": _to_seconds(row.get("Sector3Time")),
        "speedST": _safe_float(row.get("SpeedST"), 1),
        "speedFL": _safe_float(row.get("SpeedFL"), 1),
        "position": _safe_int(row.get("Position")),
    }


@app.get("/api/compare/all-laps")
def compare_all_laps(
    year: int,
    event: str,
    session: str,
    driverA: str,
    driverB: str,
    compareMode: str = Query("drivers"),
) -> dict[str, Any]:
    mode = "teams" if compareMode in {"team", "teams", "cars"} else "drivers"
    loaded = _load_session(year, event, session, telemetry=False)

    label_a = driverA
    label_b = driverB
    laps_a = _team_laps(loaded, label_a) if mode == "teams" else _driver_laps(loaded, label_a)
    laps_b = _team_laps(loaded, label_b) if mode == "teams" else _driver_laps(loaded, label_b)

    by_lap_a = _best_row_by_lap(laps_a)
    by_lap_b = _best_row_by_lap(laps_b)
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
        delta = round(time_b - time_a, 3)
        faster = label_a if delta > 0 else label_b if delta < 0 else "TIE"
        if faster == label_a:
            faster_a += 1
        elif faster == label_b:
            faster_b += 1
        item = {"lap": lap_number, "driverA": _row_payload(row_a, label_a), "driverB": _row_payload(row_b, label_b), "delta": delta, "faster": faster}
        lap_rows.append(item)
        if best_a is None or delta > best_a["delta"]:
            best_a = item
        if best_b is None or delta < best_b["delta"]:
            best_b = item
        if closest is None or abs(delta) < abs(closest["delta"]):
            closest = item

    deltas = [x["delta"] for x in lap_rows]
    avg_delta = round(float(np.mean(deltas)), 3) if deltas else None
    profile_a = _driver_profile(laps_a, label_a, mode)
    profile_b = _driver_profile(laps_b, label_b, mode)

    pace_advantage = _advantage_label(profile_a.get("medianLap"), profile_b.get("medianLap"), label_a, label_b, lower_is_better=True)
    speed_advantage = _advantage_label(profile_a.get("topSpeedAvg"), profile_b.get("topSpeedAvg"), label_a, label_b, lower_is_better=False)
    consistency_advantage = _advantage_label(profile_a.get("consistency"), profile_b.get("consistency"), label_a, label_b, lower_is_better=True)
    speed_delta_avg = round(profile_a["topSpeedAvg"] - profile_b["topSpeedAvg"], 1) if profile_a.get("topSpeedAvg") is not None and profile_b.get("topSpeedAvg") is not None else None
    median_delta = round(profile_b["medianLap"] - profile_a["medianLap"], 3) if profile_a.get("medianLap") is not None and profile_b.get("medianLap") is not None else None

    return {
        "session": {"year": year, "event": event, "session": session, "sessionName": SESSION_NAMES.get(session, session)},
        "compareMode": mode,
        "drivers": {"a": label_a, "b": label_b},
        "entities": {"a": _entity_meta(loaded, label_a, mode), "b": _entity_meta(loaded, label_b, mode)},
        "summary": {"lapsCompared": len(lap_rows), "fasterA": faster_a, "fasterB": faster_b, "averageDelta": avg_delta, "bestA": best_a, "bestB": best_b, "closest": closest},
        "profiles": {"a": profile_a, "b": profile_b},
        "carProfile": {"paceAdvantage": pace_advantage, "speedAdvantage": speed_advantage, "consistencyAdvantage": consistency_advantage, "speedDeltaAvg": speed_delta_avg, "medianDelta": median_delta},
        "insights": _build_observed_insights(profile_a, profile_b, label_a, label_b, avg_delta, mode),
        "laps": lap_rows,
    }
