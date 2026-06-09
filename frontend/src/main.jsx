import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AreaChart, Area, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, ChevronLeft, Gauge, Search, Timer, Trophy } from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const SESSION_OPTIONS = [
  { code: 'R', name: 'Race' },
  { code: 'Q', name: 'Qualifying' },
  { code: 'S', name: 'Sprint' },
  { code: 'SQ', name: 'Sprint Qualifying' },
  { code: 'FP1', name: 'Practice 1' },
  { code: 'FP2', name: 'Practice 2' },
  { code: 'FP3', name: 'Practice 3' }
];

function fmtTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  const min = Math.floor(seconds / 60);
  const sec = (seconds - min * 60).toFixed(3).padStart(6, '0');
  return `${min}:${sec}`;
}

function fmtDelta(delta, a, b) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return '—';
  if (Math.abs(delta) < 0.001) return 'Even';

  const winner = delta > 0 ? a : b;
  return `${winner} ${Math.abs(delta).toFixed(3)}s`;
}

function compoundClass(compound) {
  const value = String(compound || '').toLowerCase();

  if (value.includes('soft')) return 'soft';
  if (value.includes('medium')) return 'medium';
  if (value.includes('hard')) return 'hard';
  if (value.includes('inter')) return 'inter';
  if (value.includes('wet')) return 'wet';

  return 'unknown';
}

function TyreChip({ compound, tyreLife }) {
  const label = compound || '—';

  return (
    <span className={`tyre-chip ${compoundClass(compound)}`}>
      <span className="tyre-dot" />
      {label}
      {tyreLife !== null && tyreLife !== undefined ? <em>{tyreLife}L</em> : null}
    </span>
  );
}

function PitBadge({ show }) {
  if (!show) return null;
  return <span className="pit-badge">PIT</span>;
}

function DriverLapCell({ driver, pitted }) {
  return (
    <div className="driver-lap-cell">
      <div className="lap-time-line">
        <strong>{fmtTime(driver?.lapTime)}</strong>
        <PitBadge show={pitted} />
      </div>

      <div className="tyre-line">
        <TyreChip compound={driver?.compound} tyreLife={driver?.tyreLife} />
        {driver?.stint ? <span className="stint-label">Stint {driver.stint}</span> : null}
      </div>
    </div>
  );
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || `Request failed: ${res.status}`);
  }

  return data;
}

function Shell({ children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">RaceScope</div>
        <div className="topbar-meta">Race pace · tyre strategy · lap comparison</div>
      </header>

      {children}
    </div>
  );
}

function PillButton({ active, children, ...props }) {
  return (
    <button className={`pill ${active ? 'active' : ''}`} {...props}>
      {children}
    </button>
  );
}

function Home({ onStart }) {
  return (
    <Shell>
      <main className="home">
        <div className="hero-copy">
          <div className="eyebrow">Formula 1 race analysis</div>
          <h1>Find where the race was won or lost.</h1>
          <p>
            Choose any season, Grand Prix, session and drivers. RaceScope compares every shared lap,
            highlights pace swings, tyre phases and pit windows, then explains the race story.
          </p>

          <button className="primary" onClick={onStart}>
            Start analysis <ArrowRight size={18} />
          </button>
        </div>

        <div className="hero-card glass">
          <div className="mini-label">Current workflow</div>

          <div className="flow-lines">
            <span>Season</span>
            <i />
            <span>Race</span>
            <i />
            <span>Drivers</span>
            <i />
            <span>All laps</span>
            <i />
            <span>Tyres & pace</span>
          </div>

          <div className="hero-metric">
            <strong>All laps</strong>
            <span>not presets</span>
          </div>

          <div className="hero-metric">
            <strong>Tyre story</strong>
            <span>stints and pit windows</span>
          </div>

          <div className="hero-metric">
            <strong>Race pace</strong>
            <span>cleaner, lighter, faster</span>
          </div>
        </div>
      </main>
    </Shell>
  );
}

function SelectStep({ onBack, onCompare }) {
  const [year, setYear] = useState(2024);
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState('');
  const [session, setSession] = useState('R');
  const [drivers, setDrivers] = useState([]);
  const [driverA, setDriverA] = useState('');
  const [driverB, setDriverB] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoadingEvents(true);
    setError('');

    getJson(`/api/events?year=${year}`)
      .then((data) => {
        const list = data.events || [];
        setEvents(list);
        setEvent(list[0]?.name || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingEvents(false));
  }, [year]);

  useEffect(() => {
    if (!event) return;

    setLoadingDrivers(true);
    setError('');
    setDrivers([]);
    setDriverA('');
    setDriverB('');

    getJson(`/api/drivers?year=${year}&event=${encodeURIComponent(event)}&session=${session}`)
      .then((data) => {
        const list = data.drivers || [];
        setDrivers(list);
        setDriverA(list[0]?.code || '');
        setDriverB(list[1]?.code || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingDrivers(false));
  }, [year, event, session]);

  return (
    <Shell>
      <main className="page narrow">
        <button className="ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Back
        </button>

        <div className="section-heading">
          <div className="eyebrow">Analysis setup</div>
          <h1>Choose a race and two drivers.</h1>
          <p>
            RaceScope loads the session, discovers the drivers and compares every lap both drivers completed.
            Specific lap telemetry has been removed to keep the app fast and stable.
          </p>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="setup-grid">
          <div className="glass panel">
            <label>Season</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 9 }, (_, i) => 2026 - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <label>Grand Prix</label>
            <select value={event} onChange={(e) => setEvent(e.target.value)} disabled={loadingEvents}>
              {events.map((ev) => (
                <option key={ev.name} value={ev.name}>
                  {ev.name}
                </option>
              ))}
            </select>

            <label>Session</label>
            <div className="pill-row">
              {SESSION_OPTIONS.map((s) => (
                <PillButton key={s.code} active={session === s.code} onClick={() => setSession(s.code)}>
                  {s.name}
                </PillButton>
              ))}
            </div>
          </div>

          <div className="glass panel">
            <label>Driver A</label>
            <select value={driverA} onChange={(e) => setDriverA(e.target.value)} disabled={loadingDrivers}>
              {drivers.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>

            <label>Driver B</label>
            <select value={driverB} onChange={(e) => setDriverB(e.target.value)} disabled={loadingDrivers}>
              {drivers.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>

            <button
              className="primary wide"
              disabled={!driverA || !driverB || driverA === driverB || loadingDrivers}
              onClick={() => onCompare({ year, event, session, driverA, driverB })}
            >
              Compare all laps <Search size={18} />
            </button>

            <p className="small-note">
              First load can take a little while while FastF1 downloads and caches the session.
            </p>
          </div>
        </div>
      </main>
    </Shell>
  );
}

function Overview({ selection, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');

    const q = new URLSearchParams(selection).toString();

    getJson(`/api/compare/all-laps?${q}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selection]);

  const chartData = useMemo(() => {
    return (data?.laps || []).map((x) => ({
      lap: x.lap,
      delta: x.delta
    }));
  }, [data]);

  const enrichedLaps = useMemo(() => {
    const laps = data?.laps || [];

    return laps.map((row, index) => {
      const previous = laps[index - 1];

      const pittedA =
        previous &&
        row.driverA?.stint &&
        previous.driverA?.stint &&
        row.driverA.stint !== previous.driverA.stint;

      const pittedB =
        previous &&
        row.driverB?.stint &&
        previous.driverB?.stint &&
        row.driverB.stint !== previous.driverB.stint;

      const compoundChangeA =
        previous &&
        row.driverA?.compound &&
        previous.driverA?.compound &&
        row.driverA.compound !== previous.driverA.compound;

      const compoundChangeB =
        previous &&
        row.driverB?.compound &&
        previous.driverB?.compound &&
        row.driverB.compound !== previous.driverB.compound;

      return {
        ...row,
        pittedA: Boolean(pittedA || compoundChangeA),
        pittedB: Boolean(pittedB || compoundChangeB)
      };
    });
  }, [data]);

  const tyreSummary = useMemo(() => {
    const laps = data?.laps || [];
    if (!laps.length) return [];

    const build = (key, label) => {
      const stints = [];
      let current = null;

      laps.forEach((row) => {
        const driver = row[key] || {};
        const compound = driver.compound || 'Unknown';
        const stint = driver.stint || `${compound}-${stints.length + 1}`;

        const id = `${stint}-${compound}`;

        if (!current || current.id !== id) {
          current = {
            id,
            driver: label,
            compound,
            stint: driver.stint || stints.length + 1,
            start: row.lap,
            end: row.lap
          };
          stints.push(current);
        } else {
          current.end = row.lap;
        }
      });

      return stints;
    };

    return [
      ...build('driverA', selection.driverA),
      ...build('driverB', selection.driverB)
    ];
  }, [data, selection.driverA, selection.driverB]);

  return (
    <Shell>
      <main className="page">
        <button className="ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Change selection
        </button>

        <div className="section-heading">
          <div className="eyebrow">
            {selection.year} · {selection.event} · {selection.session}
          </div>
          <h1>{selection.driverA} vs {selection.driverB}</h1>
          <p>
            All shared laps comparison. Positive values favour {selection.driverA}; negative values favour {selection.driverB}.
            Pit and tyre changes are highlighted in the lap table.
          </p>
        </div>

        {loading && <div className="glass loading">Loading FastF1 session and comparing laps…</div>}
        {error && <div className="error">{error}</div>}

        {data && (
          <>
            <div className="summary-grid">
              <Metric icon={<Timer />} label="Laps compared" value={data.summary.lapsCompared} />
              <Metric icon={<Trophy />} label={`${selection.driverA} faster`} value={data.summary.fasterA} />
              <Metric icon={<Trophy />} label={`${selection.driverB} faster`} value={data.summary.fasterB} />
              <Metric icon={<Gauge />} label="Average delta" value={fmtDelta(data.summary.averageDelta, selection.driverA, selection.driverB)} />
            </div>

            <div className="glass chart-card">
              <div className="card-title">Lap delta trend</div>

              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                  <defs>
                    <linearGradient id="deltaFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#ff8a3d" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="#3478f6" stopOpacity={0.12} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid stroke="rgba(20,20,20,.08)" vertical={false} />
                  <XAxis dataKey="lap" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={44} />
                  <Tooltip />
                  <Area dataKey="delta" type="monotone" stroke="#1d1d1f" fill="url(#deltaFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="glass stint-card">
              <div className="card-title">Tyre phases</div>

              <div className="tyre-legend">
                <span><i className="soft" /> Soft</span>
                <span><i className="medium" /> Medium</span>
                <span><i className="hard" /> Hard</span>
                <span><i className="inter" /> Inter</span>
                <span><i className="wet" /> Wet</span>
                <span className="legend-note">PIT marks a stint or compound change</span>
              </div>

              <div className="stint-timeline">
                {tyreSummary.map((stint, index) => (
                  <div className="stint-pill" key={`${stint.driver}-${stint.id}-${index}`}>
                    <strong>{stint.driver}</strong>
                    <TyreChip compound={stint.compound} />
                    <span>L{stint.start}–{stint.end}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass table-card">
              <div className="card-title">Race pace and tyre story</div>

              <div className="lap-table">
                <div className="lap-head">
                  <span>Lap</span>
                  <span>{selection.driverA}</span>
                  <span>{selection.driverB}</span>
                  <span>Faster</span>
                  <span>Delta</span>
                </div>

                {enrichedLaps.map((row) => (
                  <div className={`lap-row strategy-row ${row.pittedA || row.pittedB ? 'pit-row' : ''}`} key={row.lap}>
                    <span className="lap-number">{row.lap}</span>

                    <DriverLapCell driver={row.driverA} pitted={row.pittedA} />
                    <DriverLapCell driver={row.driverB} pitted={row.pittedB} />

                    <span className={`faster-tag ${row.faster === selection.driverA ? 'driver-a' : row.faster === selection.driverB ? 'driver-b' : ''}`}>
                      {row.faster || '—'}
                    </span>

                    <span className="delta-pill">
                      {fmtDelta(row.delta, selection.driverA, selection.driverB)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </Shell>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="glass metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const [step, setStep] = useState('home');
  const [selection, setSelection] = useState(null);

  if (step === 'home') {
    return <Home onStart={() => setStep('select')} />;
  }

  if (step === 'select') {
    return (
      <SelectStep
        onBack={() => setStep('home')}
        onCompare={(s) => {
          setSelection(s);
          setStep('overview');
        }}
      />
    );
  }

  if (step === 'overview') {
    return <Overview selection={selection} onBack={() => setStep('select')} />;
  }

  return null;
}

createRoot(document.getElementById('root')).render(<App />);
