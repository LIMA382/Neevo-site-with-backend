import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, CartesianGrid, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowRight, ChevronLeft, Flag, Gauge, Search, Timer, Trophy, Users, Wrench, Zap } from 'lucide-react';
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

const INK = '#151515';
const GRID = 'rgba(21,21,21,.08)';
const MUTED = 'rgba(21,21,21,.48)';

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

function cssColor(value, fallback = '#151515') {
  if (!value || typeof value !== 'string') return fallback;
  return value.startsWith('#') ? value : `#${value}`;
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


function compoundColor(compound) {
  const type = compoundClass(compound);
  if (type === 'soft') return '#ff3b30';
  if (type === 'medium') return '#ffd60a';
  if (type === 'hard') return '#f5f5f7';
  if (type === 'inter') return '#34c759';
  if (type === 'wet') return '#0a84ff';
  return '#8e8e93';
}

function CompoundDot(props) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  return <circle cx={cx} cy={cy} r={4.5} fill={compoundColor(payload.compound)} stroke="#fff" strokeWidth={1.4} />;
}

function LapTooltip({ active, payload, label, name }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="chart-tooltip"><strong>{name} · Lap {label}</strong><span>{fmtTime(row.lapTime)}</span><span>{row.compound || 'Unknown tyre'}{row.tyreLife !== null && row.tyreLife !== undefined ? ` · ${row.tyreLife}L` : ''}</span>{row.pitted ? <em>PIT / tyre change</em> : null}</div>;
}

function DriverLapTimeChart({ title, data, color }) {
  return (
    <div className="glass driver-chart-card">
      <div className="card-title-row compact">
        <div><div className="chart-driver-title" style={{ color }}>{title}</div><p>Actual lap time by lap. Dots show the tyre compound used on each lap.</p></div>
        <div className="mini-legend tyre-mini-legend"><span><i className="soft" />S</span><span><i className="medium" />M</span><span><i className="hard" />H</span><span><i className="inter" />I</span><span><i className="wet" />W</span></div>
      </div>
      <ResponsiveContainer width="100%" height={270}>
        <LineChart data={data} margin={{ left: 8, right: 18, top: 18, bottom: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="lap" tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} />
          <YAxis dataKey="lapTime" tickLine={false} axisLine={false} width={54} tick={{ fill: MUTED, fontSize: 11 }} domain={["dataMin - 0.5", "dataMax + 0.5"]} tickFormatter={(value) => fmtTime(value)} />
          <Tooltip content={<LapTooltip name={title} />} cursor={{ stroke: GRID }} />
          <Line dataKey="lapTime" type="monotone" stroke={color} strokeWidth={2.6} dot={<CompoundDot />} activeDot={{ r: 6, stroke: color, strokeWidth: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div className="tyre-strip">{data.map((row) => <span key={`${title}-${row.lap}`} className={`tyre-strip-dot ${compoundClass(row.compound)} ${row.pitted ? 'pit' : ''}`} title={`Lap ${row.lap}: ${row.compound || 'Unknown'}${row.tyreLife !== null && row.tyreLife !== undefined ? ` · ${row.tyreLife}L` : ''}`} />)}</div>
    </div>
  );
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

function DriverLapCell({ driver, pitted, mode }) {
  return (
    <div className="driver-lap-cell">
      <div className="lap-time-line">
        <strong>{fmtTime(driver?.lapTime)}</strong>
        <PitBadge show={pitted} />
      </div>
      <div className="tyre-line">
        <TyreChip compound={driver?.compound} tyreLife={driver?.tyreLife} />
        {driver?.stint ? <span className="stint-label">Stint {driver.stint}</span> : null}
        {mode === 'teams' && driver?.driver ? <span className="driver-source">{driver.driver}</span> : null}
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

function Shell({ children, variant = 'light' }) {
  return (
    <div className={`shell ${variant}`}>
      <header className="topbar">
        <div className="brand">RaceScope</div>
        <div className="topbar-meta">Race pace · tyre strategy · car comparison</div>
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
    <Shell variant="home-shell">
      <main className="home-v2">
        <section className="hero-panel">
          <div className="eyebrow light">Formula 1 intelligence</div>
          <h1>Compare the race. Explain the car.</h1>
          <p>
            RaceScope turns timing, speed-trap, tyre and stint data into a clean race report.
            Compare drivers or teams, spot pit windows, and understand where the performance difference came from.
          </p>
          <button className="primary hero-primary" onClick={onStart}>Build a report <ArrowRight size={18} /></button>
        </section>

        <aside className="hero-report-card">
          <div className="hero-report-top">
            <span>Modern analysis flow</span>
            <strong>VER vs NOR</strong>
          </div>
          <div className="hero-bars">
            <div><span>Race pace</span><i style={{ width: '78%' }} /></div>
            <div><span>Straight-line speed</span><i style={{ width: '62%' }} /></div>
            <div><span>Consistency</span><i style={{ width: '86%' }} /></div>
          </div>
          <div className="hero-stat-grid">
            <div><strong>Teams</strong><span>compare cars</span></div>
            <div><strong>Tyres</strong><span>stint timeline</span></div>
            <div><strong>Speed</strong><span>trap profile</span></div>
            <div><strong>Pace</strong><span>lap delta trend</span></div>
          </div>
        </aside>
      </main>
    </Shell>
  );
}

function SelectStep({ onBack, onCompare }) {
  const [compareMode, setCompareMode] = useState('drivers');
  const [year, setYear] = useState(2024);
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState('');
  const [session, setSession] = useState('R');
  const [drivers, setDrivers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entityA, setEntityA] = useState('');
  const [entityB, setEntityB] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
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
    setLoadingEntities(true);
    setError('');
    setDrivers([]);
    setTeams([]);
    setEntityA('');
    setEntityB('');
    getJson(`/api/drivers?year=${year}&event=${encodeURIComponent(event)}&session=${session}`)
      .then((data) => {
        const driverList = data.drivers || [];
        const teamList = data.teams || [];
        setDrivers(driverList);
        setTeams(teamList);
        const list = compareMode === 'teams' ? teamList : driverList;
        setEntityA((list[0]?.name && compareMode === 'teams') ? list[0].name : list[0]?.code || '');
        setEntityB((list[1]?.name && compareMode === 'teams') ? list[1].name : list[1]?.code || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingEntities(false));
  }, [year, event, session]);

  useEffect(() => {
    const list = compareMode === 'teams' ? teams : drivers;
    setEntityA((list[0]?.name && compareMode === 'teams') ? list[0].name : list[0]?.code || '');
    setEntityB((list[1]?.name && compareMode === 'teams') ? list[1].name : list[1]?.code || '');
  }, [compareMode, drivers, teams]);

  const options = compareMode === 'teams' ? teams : drivers;
  const optionValue = (item) => compareMode === 'teams' ? item.name : item.code;
  const optionLabel = (item) => compareMode === 'teams'
    ? `${item.name} · ${item.drivers?.join(' / ') || 'team'}`
    : `${item.code} · ${item.name}${item.team ? ` · ${item.team}` : ''}`;

  return (
    <Shell>
      <main className="page narrow">
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Back</button>
        <div className="section-heading setup-heading">
          <div className="eyebrow">Analysis setup</div>
          <h1>Choose what you want to compare.</h1>
          <p>Use drivers for head-to-head race pace, or teams to compare the cars using each team’s best representative lap per lap.</p>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="mode-switch glass">
          <button className={compareMode === 'drivers' ? 'active' : ''} onClick={() => setCompareMode('drivers')}><Users size={17} /> Drivers</button>
          <button className={compareMode === 'teams' ? 'active' : ''} onClick={() => setCompareMode('teams')}><Gauge size={17} /> Teams / cars</button>
        </div>

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
            <label>{compareMode === 'teams' ? 'Team A' : 'Driver A'}</label>
            <select value={entityA} onChange={(e) => setEntityA(e.target.value)} disabled={loadingEntities}>
              {options.map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
            </select>

            <label>{compareMode === 'teams' ? 'Team B' : 'Driver B'}</label>
            <select value={entityB} onChange={(e) => setEntityB(e.target.value)} disabled={loadingEntities}>
              {options.map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
            </select>

            <button className="primary wide" disabled={!entityA || !entityB || entityA === entityB || loadingEntities} onClick={() => onCompare({ year, event, session, driverA: entityA, driverB: entityB, compareMode })}>
              Build {compareMode === 'teams' ? 'car' : 'driver'} report <Search size={18} />
            </button>
            <p className="small-note">Team colours are taken from FastF1 session metadata and used throughout the report.</p>
          </div>
        </div>
      </main>
    </Shell>
  );
}

function Metric({ icon, label, value, color }) {
  return (
    <div className="glass metric" style={{ '--metric-color': color || INK }}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightCard({ insight }) {
  return <div className="insight-card"><strong>{insight.title}</strong><p>{insight.body}</p></div>;
}

function AdvantageCard({ icon, title, winner, value, tone }) {
  return (
    <div className={`advantage-card ${tone || ''}`}>
      <div className="advantage-icon">{icon}</div>
      <span>{title}</span>
      <strong>{winner || '—'}</strong>
      <p>{value || 'No clear advantage from available data.'}</p>
    </div>
  );
}

function ProfileBar({ label, a, b, labelA, labelB, unit, lowerIsBetter = true }) {
  const hasValues = a !== null && a !== undefined && b !== null && b !== undefined;
  const max = hasValues ? Math.max(a, b) : 1;
  const aWidth = hasValues ? Math.max(6, (a / max) * 100) : 0;
  const bWidth = hasValues ? Math.max(6, (b / max) * 100) : 0;
  const winner = !hasValues ? null : lowerIsBetter ? (a < b ? labelA : labelB) : (a > b ? labelA : labelB);
  return (
    <div className="profile-bar">
      <div className="profile-bar-head"><strong>{label}</strong><span>{winner ? `${winner} edge` : 'No data'}</span></div>
      <div className="profile-bar-row"><span>{labelA}</span><div className="bar-track"><i className="bar-a" style={{ width: `${aWidth}%` }} /></div><em>{hasValues ? `${a}${unit || ''}` : '—'}</em></div>
      <div className="profile-bar-row"><span>{labelB}</span><div className="bar-track"><i className="bar-b" style={{ width: `${bWidth}%` }} /></div><em>{hasValues ? `${b}${unit || ''}` : '—'}</em></div>
    </div>
  );
}

function PitStopTable({ profiles, labelA, labelB }) {
  const rows = [];
  const addRows = (label, profile) => (profile?.stints || []).forEach((stint, index) => {
    if (index === 0) return;
    rows.push({ label, ...stint });
  });
  addRows(labelA, profiles?.a);
  addRows(labelB, profiles?.b);
  return (
    <div className="glass pit-card">
      <div className="card-title">Pit windows</div>
      {rows.length ? (
        <div className="pit-table">
          <div className="pit-head"><span>Entry</span><span>Pit lap</span><span>New tyre</span><span>Stint</span></div>
          {rows.map((row, index) => (
            <div className="pit-row-small" key={`${row.label}-${row.startLap}-${index}`}>
              <strong>{row.label}{row.driver ? ` · ${row.driver}` : ''}</strong>
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

function TyreTimeline({ profiles, labelA, labelB }) {
  const maxLap = Math.max(...((profiles?.a?.stints || []).map((x) => x.endLap || 0)), ...((profiles?.b?.stints || []).map((x) => x.endLap || 0)), 1);
  const Row = ({ label, profile }) => (
    <div className="timeline-row">
      <strong>{label}</strong>
      <div className="timeline-track">
        {(profile?.stints || []).map((stint, index) => {
          const left = (((stint.startLap || 1) - 1) / maxLap) * 100;
          const width = (((stint.endLap || stint.startLap || 1) - (stint.startLap || 1) + 1) / maxLap) * 100;
          return <span key={`${label}-${stint.stint}-${index}`} className={`stint-segment ${compoundClass(stint.compound)}`} style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }} title={`${label} ${stint.compound} L${stint.startLap}–${stint.endLap}`}><em>L{stint.startLap}–{stint.endLap}</em></span>;
        })}
      </div>
    </div>
  );
  return (
    <div className="glass strategy-card">
      <div className="card-title">Tyre strategy timeline</div>
      <div className="tyre-legend"><span><i className="soft" /> Soft</span><span><i className="medium" /> Medium</span><span><i className="hard" /> Hard</span><span><i className="inter" /> Inter</span><span><i className="wet" /> Wet</span></div>
      <div className="timeline-wrap"><Row label={labelA} profile={profiles?.a} /><Row label={labelB} profile={profiles?.b} /></div>
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

  const a = data?.drivers?.a || selection.driverA;
  const b = data?.drivers?.b || selection.driverB;
  const colorA = cssColor(data?.entities?.a?.color, '#3671C6');
  const colorB = cssColor(data?.entities?.b?.color, '#FF8000');

  const lapTimeCharts = useMemo(() => {
    const laps = data?.laps || [];
    const buildRows = (key) => laps.map((row, index) => {
      const current = row[key] || {};
      const previous = index > 0 ? laps[index - 1]?.[key] : null;
      const pitted = Boolean(previous && ((current.stint && previous.stint && current.stint !== previous.stint) || (current.compound && previous.compound && current.compound !== previous.compound)));
      return { lap: row.lap, lapTime: current.lapTime, compound: current.compound || 'Unknown', tyreLife: current.tyreLife, stint: current.stint, pitted, driver: current.driver };
    });
    return { a: buildRows('driverA'), b: buildRows('driverB') };
  }, [data]);

  const speedChart = useMemo(() => {
    if (!data?.profiles) return [];
    return [
      { metric: 'Average speed trap', [a]: data.profiles.a?.topSpeedAvg, [b]: data.profiles.b?.topSpeedAvg },
      { metric: 'Maximum speed trap', [a]: data.profiles.a?.topSpeedMax, [b]: data.profiles.b?.topSpeedMax }
    ];
  }, [data, a, b]);

  const enrichedLaps = useMemo(() => {
    const laps = data?.laps || [];
    return laps.map((row, index) => {
      const previous = laps[index - 1];
      const pittedA = previous && ((row.driverA?.stint && previous.driverA?.stint && row.driverA.stint !== previous.driverA.stint) || (row.driverA?.compound && previous.driverA?.compound && row.driverA.compound !== previous.driverA.compound));
      const pittedB = previous && ((row.driverB?.stint && previous.driverB?.stint && row.driverB.stint !== previous.driverB.stint) || (row.driverB?.compound && previous.driverB?.compound && row.driverB.compound !== previous.driverB.compound));
      return { ...row, pittedA: Boolean(pittedA), pittedB: Boolean(pittedB) };
    });
  }, [data]);

  return (
    <Shell>
      <main className="page report-page" style={{ '--color-a': colorA, '--color-b': colorB }}>
        <button className="ghost" onClick={onBack}><ChevronLeft size={16} /> Change selection</button>
        <div className="report-hero glass">
          <div>
            <div className="eyebrow">{selection.year} · {selection.event} · {selection.session} · {selection.compareMode === 'teams' ? 'Team comparison' : 'Driver comparison'}</div>
            <h1 className="entity-heading"><span className="entity-name entity-a">{a}</span><em>vs</em><span className="entity-name entity-b">{b}</span></h1>
            <p>Timing, tyre degradation, stint and speed-trap report. Team colours are used consistently across charts, labels and cards.</p>
          </div>
          <div className="team-color-key"><i style={{ background: colorA }} /><strong>{a}</strong><i style={{ background: colorB }} /><strong>{b}</strong></div>
        </div>

        {loading && <div className="glass loading">Loading session and building report…</div>}
        {error && <div className="error">{error}</div>}

        {data && (
          <>
            <div className="summary-grid">
              <Metric icon={<Timer />} label="Laps compared" value={data.summary.lapsCompared} />
              <Metric icon={<Trophy />} label={`${a} faster`} value={data.summary.fasterA} color={colorA} />
              <Metric icon={<Trophy />} label={`${b} faster`} value={data.summary.fasterB} color={colorB} />
              <Metric icon={<Gauge />} label="Average delta" value={fmtDelta(data.summary.averageDelta, a, b)} />
            </div>

            <div className="driver-chart-grid">
              <DriverLapTimeChart title={a} data={lapTimeCharts.a} color={colorA} />
              <DriverLapTimeChart title={b} data={lapTimeCharts.b} color={colorB} />
            </div>

            <div className="glass insights-panel wide-insights"><div className="card-title">Observed difference</div>{(data.insights || []).map((insight, index) => <InsightCard insight={insight} key={index} />)}</div>

            <div className="car-profile-grid">
              <AdvantageCard icon={<Activity />} title="Race pace" winner={data.carProfile?.paceAdvantage?.driver} value={data.carProfile?.medianDelta !== null && data.carProfile?.medianDelta !== undefined ? `${fmtDelta(data.carProfile.medianDelta, a, b)} median pace` : null} tone="pace" />
              <AdvantageCard icon={<Zap />} title="Straight-line speed" winner={data.carProfile?.speedAdvantage?.driver} value={data.carProfile?.speedDeltaAvg !== null && data.carProfile?.speedDeltaAvg !== undefined ? `${Math.abs(data.carProfile.speedDeltaAvg).toFixed(1)} km/h speed-trap difference` : null} tone="speed" />
              <AdvantageCard icon={<Wrench />} title="Consistency" winner={data.carProfile?.consistencyAdvantage?.driver} value={data.carProfile?.consistencyAdvantage?.amount !== null && data.carProfile?.consistencyAdvantage?.amount !== undefined ? `${data.carProfile.consistencyAdvantage.amount.toFixed(3)}s smaller spread` : null} tone="consistency" />
            </div>

            <div className="glass profile-card">
              <div className="card-title">Car profile from timing data</div>
              <div className="profile-grid">
                <ProfileBar label="Median race lap" a={data.profiles?.a?.medianLap} b={data.profiles?.b?.medianLap} labelA={a} labelB={b} unit="s" lowerIsBetter />
                <ProfileBar label="Consistency spread" a={data.profiles?.a?.consistency} b={data.profiles?.b?.consistency} labelA={a} labelB={b} unit="s" lowerIsBetter />
                <ProfileBar label="Average speed trap" a={data.profiles?.a?.topSpeedAvg} b={data.profiles?.b?.topSpeedAvg} labelA={a} labelB={b} unit=" km/h" lowerIsBetter={false} />
              </div>
            </div>

            <div className="report-grid two"><TyreTimeline profiles={data.profiles} labelA={a} labelB={b} /><PitStopTable profiles={data.profiles} labelA={a} labelB={b} /></div>

            <div className="glass speed-card">
              <div className="card-title">Speed-trap comparison</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={speedChart} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="metric" tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: MUTED, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'rgba(21,21,21,.04)' }} />
                  <Bar dataKey={a} fill={colorA} radius={[10, 10, 0, 0]} />
                  <Bar dataKey={b} fill={colorB} radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass table-card">
              <div className="card-title">Lap-by-lap race pace and tyre story</div>
              <div className="tyre-legend"><span><i className="soft" /> Soft</span><span><i className="medium" /> Medium</span><span><i className="hard" /> Hard</span><span><i className="inter" /> Inter</span><span><i className="wet" /> Wet</span><span className="legend-note"><Flag size={13} /> PIT marks a stint or compound change</span></div>
              <div className="lap-table">
                <div className="lap-head"><span>Lap</span><span>{a}</span><span>{b}</span><span>Faster</span><span>Delta</span></div>
                {enrichedLaps.map((row) => (
                  <div className={`lap-row strategy-row ${row.pittedA || row.pittedB ? 'pit-row' : ''}`} key={row.lap}>
                    <span className="lap-number">{row.lap}</span>
                    <DriverLapCell driver={row.driverA} pitted={row.pittedA} mode={data.compareMode} />
                    <DriverLapCell driver={row.driverB} pitted={row.pittedB} mode={data.compareMode} />
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
