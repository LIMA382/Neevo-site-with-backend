import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, ChevronLeft, Gauge, Search, Timer, Trophy, Zap, Activity, Wrench, Flag } from 'lucide-react';
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
  if (!res.ok) throw new Error(data.detail || `Request failed: ${res.status}`);
  return data;
}

function Shell({ children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">RaceScope</div>
        <div className="topbar-meta">Race pace · tyre strategy · observed car profile</div>
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
          <div className="eyebrow">Formula 1 race intelligence</div>
          <h1>Explain the race, not just the lap time.</h1>
          <p>
            Choose any season, Grand Prix, session and drivers. RaceScope compares shared laps,
            tyre phases, pit windows, race pace and observed car differences from timing and speed data.
          </p>
          <button className="primary" onClick={onStart}>Start analysis <ArrowRight size={18} /></button>
        </div>
        <div className="hero-card glass">
          <div className="mini-label">Analysis report</div>
          <div className="flow-lines">
            <span>Race selection</span><i />
            <span>Driver comparison</span><i />
            <span>Lap delta trend</span><i />
            <span>Tyre strategy</span><i />
            <span>Observed car profile</span>
          </div>
          <div className="hero-metric"><strong>All laps</strong><span>race-wide comparison</span></div>
          <div className="hero-metric"><strong>Tyres</strong><span>stints and pit windows</span></div>
          <div className="hero-metric"><strong>Cars</strong><span>pace, speed and consistency</span></div>
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
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Back</button>
        <div className="section-heading">
          <div className="eyebrow">Analysis setup</div>
          <h1>Choose a race and two drivers.</h1>
          <p>
            This version avoids heavy per-lap telemetry. It builds a stable race report using lap timing,
            tyre compounds, stints, speed-trap data and pit windows.
          </p>
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
              {SESSION_OPTIONS.map((s) => (
                <PillButton key={s.code} active={session === s.code} onClick={() => setSession(s.code)}>{s.name}</PillButton>
              ))}
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
            <button
              className="primary wide"
              disabled={!driverA || !driverB || driverA === driverB || loadingDrivers}
              onClick={() => onCompare({ year, event, session, driverA, driverB })}
            >
              Build race report <Search size={18} />
            </button>
            <p className="small-note">First load can take a little while while FastF1 downloads and caches the session.</p>
          </div>
        </div>
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

function InsightCard({ insight }) {
  return (
    <div className="insight-card">
      <strong>{insight.title}</strong>
      <p>{insight.body}</p>
    </div>
  );
}

function AdvantageCard({ icon, title, winner, value, note, tone }) {
  return (
    <div className={`advantage-card ${tone || ''}`}>
      <div className="advantage-icon">{icon}</div>
      <span>{title}</span>
      <strong>{winner || '—'}</strong>
      <p>{value || note || 'No clear advantage from available data.'}</p>
    </div>
  );
}

function ProfileBar({ label, a, b, driverA, driverB, unit, lowerIsBetter = true }) {
  const hasValues = a !== null && a !== undefined && b !== null && b !== undefined;
  const max = hasValues ? Math.max(a, b) : 1;
  const aWidth = hasValues ? Math.max(8, (a / max) * 100) : 0;
  const bWidth = hasValues ? Math.max(8, (b / max) * 100) : 0;
  const winner = !hasValues ? null : lowerIsBetter ? (a < b ? driverA : driverB) : (a > b ? driverA : driverB);

  return (
    <div className="profile-bar">
      <div className="profile-bar-head">
        <strong>{label}</strong>
        <span>{winner ? `${winner} edge` : 'No data'}</span>
      </div>
      <div className="profile-bar-row">
        <span>{driverA}</span>
        <div className="bar-track"><i className="bar-a" style={{ width: `${aWidth}%` }} /></div>
        <em>{hasValues ? `${a}${unit || ''}` : '—'}</em>
      </div>
      <div className="profile-bar-row">
        <span>{driverB}</span>
        <div className="bar-track"><i className="bar-b" style={{ width: `${bWidth}%` }} /></div>
        <em>{hasValues ? `${b}${unit || ''}` : '—'}</em>
      </div>
    </div>
  );
}

function PitStopTable({ profiles, driverA, driverB }) {
  const rows = [];
  const addRows = (driver, profile) => {
    (profile?.stints || []).forEach((stint, index) => {
      if (index === 0) return;
      rows.push({ driver, ...stint });
    });
  };
  addRows(driverA, profiles?.a);
  addRows(driverB, profiles?.b);

  return (
    <div className="glass pit-card">
      <div className="card-title">Pit windows</div>
      {rows.length ? (
        <div className="pit-table">
          <div className="pit-head"><span>Driver</span><span>Pit lap</span><span>New tyre</span><span>Stint</span></div>
          {rows.map((row, index) => (
            <div className="pit-row-small" key={`${row.driver}-${row.startLap}-${index}`}>
              <strong>{row.driver}</strong>
              <span>L{row.pitLap || row.startLap}</span>
              <TyreChip compound={row.compound} />
              <span>L{row.startLap}–{row.endLap}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted">No pit or compound changes detected in the compared laps.</p>}
    </div>
  );
}

function TyreTimeline({ profiles, driverA, driverB }) {
  const maxLap = Math.max(
    ...((profiles?.a?.stints || []).map((x) => x.endLap || 0)),
    ...((profiles?.b?.stints || []).map((x) => x.endLap || 0)),
    1
  );

  const Row = ({ driver, profile }) => (
    <div className="timeline-row">
      <strong>{driver}</strong>
      <div className="timeline-track">
        {(profile?.stints || []).map((stint, index) => {
          const left = (((stint.startLap || 1) - 1) / maxLap) * 100;
          const width = (((stint.endLap || stint.startLap || 1) - (stint.startLap || 1) + 1) / maxLap) * 100;
          return (
            <span
              key={`${driver}-${stint.stint}-${index}`}
              className={`stint-segment ${compoundClass(stint.compound)}`}
              style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
              title={`${driver} ${stint.compound} L${stint.startLap}–${stint.endLap}`}
            >
              <em>L{stint.startLap}–{stint.endLap}</em>
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="glass strategy-card">
      <div className="card-title">Tyre strategy timeline</div>
      <div className="tyre-legend">
        <span><i className="soft" /> Soft</span>
        <span><i className="medium" /> Medium</span>
        <span><i className="hard" /> Hard</span>
        <span><i className="inter" /> Inter</span>
        <span><i className="wet" /> Wet</span>
      </div>
      <div className="timeline-wrap">
        <Row driver={driverA} profile={profiles?.a} />
        <Row driver={driverB} profile={profiles?.b} />
      </div>
    </div>
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

  const chartData = useMemo(() => (data?.laps || []).map((x) => ({ lap: x.lap, delta: x.delta })), [data]);

  const speedChart = useMemo(() => {
    if (!data?.profiles) return [];
    return [
      { metric: 'Avg speed trap', [selection.driverA]: data.profiles.a?.topSpeedAvg, [selection.driverB]: data.profiles.b?.topSpeedAvg },
      { metric: 'Max speed trap', [selection.driverA]: data.profiles.a?.topSpeedMax, [selection.driverB]: data.profiles.b?.topSpeedMax }
    ];
  }, [data, selection.driverA, selection.driverB]);

  const enrichedLaps = useMemo(() => {
    const laps = data?.laps || [];
    return laps.map((row, index) => {
      const previous = laps[index - 1];
      const pittedA = previous && (
        (row.driverA?.stint && previous.driverA?.stint && row.driverA.stint !== previous.driverA.stint) ||
        (row.driverA?.compound && previous.driverA?.compound && row.driverA.compound !== previous.driverA.compound)
      );
      const pittedB = previous && (
        (row.driverB?.stint && previous.driverB?.stint && row.driverB.stint !== previous.driverB.stint) ||
        (row.driverB?.compound && previous.driverB?.compound && row.driverB.compound !== previous.driverB.compound)
      );
      return { ...row, pittedA: Boolean(pittedA), pittedB: Boolean(pittedB) };
    });
  }, [data]);

  const a = selection.driverA;
  const b = selection.driverB;

  return (
    <Shell>
      <main className="page">
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Change selection</button>
        <div className="section-heading report-heading">
          <div className="eyebrow">{selection.year} · {selection.event} · {selection.session}</div>
          <h1>{a} vs {b}</h1>
          <p>
            Full race comparison using timing, tyre, stint and speed-trap data. This avoids heavy telemetry loading,
            but still explains observed car and strategy differences.
          </p>
        </div>

        {loading && <div className="glass loading">Loading session and building race report…</div>}
        {error && <div className="error">{error}</div>}

        {data && (
          <>
            <div className="summary-grid">
              <Metric icon={<Timer />} label="Laps compared" value={data.summary.lapsCompared} />
              <Metric icon={<Trophy />} label={`${a} faster`} value={data.summary.fasterA} />
              <Metric icon={<Trophy />} label={`${b} faster`} value={data.summary.fasterB} />
              <Metric icon={<Gauge />} label="Average delta" value={fmtDelta(data.summary.averageDelta, a, b)} />
            </div>

            <div className="report-grid">
              <div className="glass chart-card large-card">
                <div className="card-title">Lap delta trend</div>
                <ResponsiveContainer width="100%" height={270}>
                  <AreaChart data={chartData} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                    <defs>
                      <linearGradient id="deltaFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#ff8a3d" stopOpacity={0.36} />
                        <stop offset="95%" stopColor="#3478f6" stopOpacity={0.14} />
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

              <div className="glass insights-panel">
                <div className="card-title">Observed difference</div>
                {(data.insights || []).map((insight, index) => <InsightCard insight={insight} key={index} />)}
              </div>
            </div>

            <div className="car-profile-grid">
              <AdvantageCard
                icon={<Activity />}
                title="Race pace"
                winner={data.carProfile?.paceAdvantage?.driver}
                value={data.carProfile?.medianDelta !== null && data.carProfile?.medianDelta !== undefined ? `${fmtDelta(data.carProfile.medianDelta, a, b)} median pace` : null}
                tone="pace"
              />
              <AdvantageCard
                icon={<Zap />}
                title="Straight-line speed"
                winner={data.carProfile?.speedAdvantage?.driver}
                value={data.carProfile?.speedDeltaAvg !== null && data.carProfile?.speedDeltaAvg !== undefined ? `${Math.abs(data.carProfile.speedDeltaAvg).toFixed(1)} km/h average speed-trap difference` : null}
                tone="speed"
              />
              <AdvantageCard
                icon={<Wrench />}
                title="Consistency"
                winner={data.carProfile?.consistencyAdvantage?.driver}
                value={data.carProfile?.consistencyAdvantage?.amount !== null && data.carProfile?.consistencyAdvantage?.amount !== undefined ? `${data.carProfile.consistencyAdvantage.amount.toFixed(3)}s smaller lap-time spread` : null}
                tone="consistency"
              />
            </div>

            <div className="glass profile-card">
              <div className="card-title">Car profile from timing data</div>
              <div className="profile-grid">
                <ProfileBar label="Median race lap" a={data.profiles?.a?.medianLap} b={data.profiles?.b?.medianLap} driverA={a} driverB={b} unit="s" lowerIsBetter />
                <ProfileBar label="Consistency spread" a={data.profiles?.a?.consistency} b={data.profiles?.b?.consistency} driverA={a} driverB={b} unit="s" lowerIsBetter />
                <ProfileBar label="Average speed trap" a={data.profiles?.a?.topSpeedAvg} b={data.profiles?.b?.topSpeedAvg} driverA={a} driverB={b} unit=" km/h" lowerIsBetter={false} />
              </div>
            </div>

            <div className="report-grid two">
              <TyreTimeline profiles={data.profiles} driverA={a} driverB={b} />
              <PitStopTable profiles={data.profiles} driverA={a} driverB={b} />
            </div>

            <div className="glass speed-card">
              <div className="card-title">Speed-trap comparison</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={speedChart} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(20,20,20,.08)" vertical={false} />
                  <XAxis dataKey="metric" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={44} />
                  <Tooltip />
                  <Bar dataKey={a} fill="#3478f6" radius={[8, 8, 0, 0]} />
                  <Bar dataKey={b} fill="#ff8a3d" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass table-card">
              <div className="card-title">Lap-by-lap race pace and tyre story</div>
              <div className="tyre-legend">
                <span><i className="soft" /> Soft</span>
                <span><i className="medium" /> Medium</span>
                <span><i className="hard" /> Hard</span>
                <span><i className="inter" /> Inter</span>
                <span><i className="wet" /> Wet</span>
                <span className="legend-note"><Flag size={13} /> PIT marks a stint or compound change</span>
              </div>
              <div className="lap-table">
                <div className="lap-head"><span>Lap</span><span>{a}</span><span>{b}</span><span>Faster</span><span>Delta</span></div>
                {enrichedLaps.map((row) => (
                  <div className={`lap-row strategy-row ${row.pittedA || row.pittedB ? 'pit-row' : ''}`} key={row.lap}>
                    <span className="lap-number">{row.lap}</span>
                    <DriverLapCell driver={row.driverA} pitted={row.pittedA} />
                    <DriverLapCell driver={row.driverB} pitted={row.pittedB} />
                    <span className={`faster-tag ${row.faster === a ? 'driver-a' : row.faster === b ? 'driver-b' : ''}`}>{row.faster || '—'}</span>
                    <span className="delta-pill">{fmtDelta(row.delta, a, b)}</span>
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

function App() {
  const [step, setStep] = useState('home');
  const [selection, setSelection] = useState(null);

  if (step === 'home') return <Home onStart={() => setStep('select')} />;
  if (step === 'select') return <SelectStep onBack={() => setStep('home')} onCompare={(s) => { setSelection(s); setStep('overview'); }} />;
  if (step === 'overview') return <Overview selection={selection} onBack={() => setStep('select')} />;
  return null;
}

createRoot(document.getElementById('root')).render(<App />);
