import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AreaChart, Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed: ${res.status}`);
  return data;
}

function Shell({ children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">RaceScope</div>
        <div className="topbar-meta">Live FastF1 data · Render backend</div>
      </header>
      {children}
    </div>
  );
}

function PillButton({ active, children, ...props }) {
  return <button className={`pill ${active ? 'active' : ''}`} {...props}>{children}</button>;
}

function Home({ onStart }) {
  return (
    <Shell>
      <main className="home">
        <div className="hero-copy">
          <div className="eyebrow">Formula 1 telemetry analysis</div>
          <h1>Find where the time was won or lost.</h1>
          <p>Choose any season, Grand Prix, session and drivers. RaceScope compares every shared lap, then opens a clean telemetry view for the lap you care about.</p>
          <button className="primary" onClick={onStart}>Start analysis <ArrowRight size={18} /></button>
        </div>
        <div className="hero-card glass">
          <div className="mini-label">Current workflow</div>
          <div className="flow-lines">
            <span>Season</span><i />
            <span>Race</span><i />
            <span>Drivers</span><i />
            <span>All laps</span><i />
            <span>Telemetry</span>
          </div>
          <div className="hero-metric"><strong>All laps</strong><span>not presets</span></div>
          <div className="hero-metric"><strong>All drivers</strong><span>from loaded session</span></div>
          <div className="hero-metric"><strong>All circuits</strong><span>from FastF1 schedule</span></div>
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
        setEvents(data.events || []);
        const first = (data.events || [])[0]?.name || '';
        setEvent(first);
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
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Back</button>
        <div className="section-heading">
          <div className="eyebrow">Analysis setup</div>
          <h1>Choose a race and two drivers.</h1>
          <p>The backend loads the actual session, discovers drivers, and compares every lap both drivers completed.</p>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="setup-grid">
          <div className="glass panel">
            <label>Season</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 9 }, (_, i) => 2026 - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <label>Grand Prix</label>
            <select value={event} onChange={(e) => setEvent(e.target.value)} disabled={loadingEvents}>
              {events.map((ev) => <option key={ev.name} value={ev.name}>{ev.name}</option>)}
            </select>
            <label>Session</label>
            <div className="pill-row">
              {SESSION_OPTIONS.map((s) => <PillButton key={s.code} active={session === s.code} onClick={() => setSession(s.code)}>{s.name}</PillButton>)}
            </div>
          </div>

          <div className="glass panel">
            <label>Driver A</label>
            <select value={driverA} onChange={(e) => setDriverA(e.target.value)} disabled={loadingDrivers}>
              {drivers.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
            </select>
            <label>Driver B</label>
            <select value={driverB} onChange={(e) => setDriverB(e.target.value)} disabled={loadingDrivers}>
              {drivers.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
            </select>
            <button className="primary wide" disabled={!driverA || !driverB || driverA === driverB || loadingDrivers} onClick={() => onCompare({ year, event, session, driverA, driverB })}>
              Compare all laps <Search size={18} />
            </button>
            <p className="small-note">First load can take a while while FastF1 downloads and caches the session.</p>
          </div>
        </div>
      </main>
    </Shell>
  );
}

function Overview({ selection, onBack, onLap }) {
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

  const chartData = useMemo(() => (data?.laps || []).map((x) => ({ lap: x.lap, delta: x.delta })), [data]);

  return (
    <Shell>
      <main className="page">
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Change selection</button>
        <div className="section-heading">
          <div className="eyebrow">{selection.year} · {selection.event} · {selection.session}</div>
          <h1>{selection.driverA} vs {selection.driverB}</h1>
          <p>All shared laps comparison. Positive values favour {selection.driverA}; negative values favour {selection.driverB}.</p>
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
                      <stop offset="5%" stopColor="#ff8a3d" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3478f6" stopOpacity={0.1} />
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
            <div className="glass table-card">
              <div className="card-title">Lap browser</div>
              <div className="lap-table">
                <div className="lap-head"><span>Lap</span><span>{selection.driverA}</span><span>{selection.driverB}</span><span>Faster</span><span>Delta</span><span /></div>
                {data.laps.map((row) => (
                  <button className="lap-row" key={row.lap} onClick={() => onLap(row.lap)}>
                    <span>{row.lap}</span>
                    <span>{fmtTime(row.driverA.lapTime)} · {row.driverA.compound || '—'}</span>
                    <span>{fmtTime(row.driverB.lapTime)} · {row.driverB.compound || '—'}</span>
                    <span>{row.faster}</span>
                    <span>{Math.abs(row.delta).toFixed(3)}s</span>
                    <ArrowRight size={16} />
                  </button>
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
  return <div className="glass metric"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function LapDetail({ selection, lap, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    const q = new URLSearchParams({ ...selection, lap }).toString();
    getJson(`/api/compare/lap?${q}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selection, lap]);

  const telemetry = useMemo(() => {
    if (!data) return [];
    const a = data.telemetry.a;
    const b = data.telemetry.b;
    const deltaMap = new Map((data.telemetry.delta.distance || []).map((d, i) => [Math.round(d), data.telemetry.delta.delta[i]]));
    return (a.distance || []).map((d, i) => ({
      distance: Math.round(d),
      speedA: a.speed[i],
      speedB: b.speed[i],
      throttleA: a.throttle[i],
      throttleB: b.throttle[i],
      delta: deltaMap.get(Math.round(d)) ?? null
    }));
  }, [data]);

  return (
    <Shell>
      <main className="page">
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> All laps</button>
        {loading && <div className="glass loading">Loading lap telemetry…</div>}
        {error && <div className="error">{error}</div>}
        {data && (
          <>
            <section className="lap-hero glass">
              <div>
                <div className="eyebrow">Lap {lap} · {selection.event}</div>
                <h1>{selection.driverA} vs {selection.driverB}</h1>
                <p>{fmtDelta(data.metrics.finishDelta, selection.driverA, selection.driverB)} at the line.</p>
              </div>
              <div className="big-delta">{data.metrics.finishDelta === null ? '—' : `${data.metrics.finishDelta > 0 ? '+' : ''}${data.metrics.finishDelta.toFixed(3)}s`}</div>
            </section>
            <div className="detail-grid">
              <div className="glass track-card">
                <div className="card-title">Track trace</div>
                <svg viewBox="0 0 100 100" className="track-svg">
                  <polyline points={(data.track.points || []).map((p) => `${p.x},${100 - p.y}`).join(' ')} fill="none" stroke="rgba(29,29,31,.72)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="glass insights-card">
                <div className="card-title">Explain the gap</div>
                {(data.insights || []).map((insight, index) => <div className="insight" key={index}><strong>{insight.title}</strong><span>{insight.body}</span></div>)}
                <div className="mini-metrics"><span>Top speed {selection.driverA}: {data.metrics.topSpeedA || '—'} km/h</span><span>Top speed {selection.driverB}: {data.metrics.topSpeedB || '—'} km/h</span></div>
              </div>
            </div>
            <div className="glass chart-card">
              <div className="card-title">Speed trace</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={telemetry} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(20,20,20,.08)" vertical={false} />
                  <XAxis dataKey="distance" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={44} />
                  <Tooltip />
                  <Line dataKey="speedA" name={selection.driverA} type="monotone" dot={false} stroke="#3478f6" strokeWidth={2} />
                  <Line dataKey="speedB" name={selection.driverB} type="monotone" dot={false} stroke="#ff8a3d" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </main>
    </Shell>
  );
}

function App() {
  const [step, setStep] = useState('home');
  const [selection, setSelection] = useState(null);
  const [lap, setLap] = useState(null);

  if (step === 'home') return <Home onStart={() => setStep('select')} />;
  if (step === 'select') return <SelectStep onBack={() => setStep('home')} onCompare={(s) => { setSelection(s); setStep('overview'); }} />;
  if (step === 'overview') return <Overview selection={selection} onBack={() => setStep('select')} onLap={(l) => { setLap(l); setStep('lap'); }} />;
  if (step === 'lap') return <LapDetail selection={selection} lap={lap} onBack={() => setStep('overview')} />;
  return null;
}

createRoot(document.getElementById('root')).render(<App />);
