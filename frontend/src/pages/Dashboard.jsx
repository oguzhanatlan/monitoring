import { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '../api/client.js';
import { connectNamespace } from '../api/socket.js';

const HISTORY = 60; // grafikte tutulan örnek sayısı (~2 dakika)

function formatBytes(bytes, perSec = false) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}${perSec ? '/s' : ''}`;
}

function formatUptime(sec) {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}g ${h}s ${m}dk`;
}

function MetricChart({ data, dataKey, color, unit, domain }) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis domain={domain || [0, 'auto']} width={44} tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          formatter={(v) => [`${typeof v === 'number' ? v.toFixed(1) : v}${unit}`, '']}
          labelFormatter={() => ''}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          fill={`url(#grad-${dataKey})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const [info, setInfo] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [procs, setProcs] = useState(null);
  const [services, setServices] = useState([]);
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    api.get('/system/info').then((res) => setInfo(res.data)).catch(() => {});

    const socket = connectNamespace('/system');
    socketRef.current = socket;

    socket.on('stats', (s) => {
      setStats(s);
      const rx = s.network.reduce((sum, n) => sum + (n.rxSec || 0), 0);
      const tx = s.network.reduce((sum, n) => sum + (n.txSec || 0), 0);
      setHistory((h) =>
        [
          ...h,
          {
            t: s.ts,
            cpu: s.cpu.load,
            ram: (s.mem.used / s.mem.total) * 100,
            rx: rx / 1024,
            tx: tx / 1024,
          },
        ].slice(-HISTORY)
      );
    });
    socket.on('processes', setProcs);
    socket.on('services', setServices);

    return () => socket.disconnect();
  }, []);

  async function killProcess(p) {
    if (!confirm(`${p.name} (PID ${p.pid}) sonlandırılsın mı?`)) return;
    setError('');
    try {
      await api.post('/system/kill', { pid: p.pid });
    } catch (err) {
      setError(err.response?.data?.error || 'Process sonlandırılamadı');
    }
  }

  return (
    <div className="page">
      <h2>Dashboard</h2>
      {error && <p className="error">{error}</p>}

      <div className="stat-cards">
        <div className="stat-card">
          <span className="dim">CPU</span>
          <strong>{stats ? `${stats.cpu.load.toFixed(1)}%` : '—'}</strong>
          <span className="dim small">
            {info ? `${info.cpu.brand} · ${info.cpu.cores} çekirdek` : ''}
            {stats?.cpu.temp ? ` · ${stats.cpu.temp}°C` : ''}
          </span>
          <span className="dim small">
            Load: {stats ? stats.cpu.loads.map((l) => l.toFixed(2)).join(' / ') : '—'}
          </span>
        </div>
        <div className="stat-card">
          <span className="dim">RAM</span>
          <strong>{stats ? `${((stats.mem.used / stats.mem.total) * 100).toFixed(1)}%` : '—'}</strong>
          <span className="dim small">
            {stats ? `${formatBytes(stats.mem.used)} / ${formatBytes(stats.mem.total)}` : ''}
          </span>
          <span className="dim small">
            Swap: {stats ? `${formatBytes(stats.mem.swapUsed)} / ${formatBytes(stats.mem.swapTotal)}` : '—'}
          </span>
        </div>
        <div className="stat-card">
          <span className="dim">Ağ</span>
          <strong>
            {stats
              ? `↓ ${formatBytes(stats.network.reduce((s, n) => s + (n.rxSec || 0), 0), true)}`
              : '—'}
          </strong>
          <span className="dim small">
            {stats
              ? `↑ ${formatBytes(stats.network.reduce((s, n) => s + (n.txSec || 0), 0), true)}`
              : ''}
          </span>
        </div>
        <div className="stat-card">
          <span className="dim">Uptime</span>
          <strong>{formatUptime(stats?.uptime)}</strong>
          <span className="dim small">{info ? `${info.os.distro} · ${info.os.kernel}` : ''}</span>
        </div>
      </div>

      <div className="chart-grid">
        <section className="panel">
          <h3>CPU Kullanımı (%)</h3>
          <MetricChart data={history} dataKey="cpu" color="#38bdf8" unit="%" domain={[0, 100]} />
        </section>
        <section className="panel">
          <h3>RAM Kullanımı (%)</h3>
          <MetricChart data={history} dataKey="ram" color="#4ade80" unit="%" domain={[0, 100]} />
        </section>
        <section className="panel">
          <h3>İndirme (KB/s)</h3>
          <MetricChart data={history} dataKey="rx" color="#a78bfa" unit=" KB/s" />
        </section>
        <section className="panel">
          <h3>Yükleme (KB/s)</h3>
          <MetricChart data={history} dataKey="tx" color="#fbbf24" unit=" KB/s" />
        </section>
      </div>

      {services.length > 0 && (
        <section className="panel">
          <h3>Servisler</h3>
          <div className="service-list">
            {services.map((s) => (
              <span key={s.name} className={`service ${s.status}`}>
                <i className="service-dot" /> {s.name}: {s.status}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Diskler</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Bağlama noktası</th>
              <th>Dosya sistemi</th>
              <th>Kullanım</th>
              <th>Boyut</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.disks || []).map((d) => (
              <tr key={d.mount}>
                <td>{d.mount}</td>
                <td>{d.fs}</td>
                <td>
                  <div className="usage-bar">
                    <div
                      className="usage-fill"
                      style={{
                        width: `${d.use}%`,
                        background: d.use > 90 ? 'var(--danger)' : 'var(--accent)',
                      }}
                    />
                  </div>
                  {d.use?.toFixed(1)}% ({formatBytes(d.used)})
                </td>
                <td>{formatBytes(d.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>
          Process'ler{' '}
          <span className="dim small">
            {procs ? `(toplam ${procs.all}, çalışan ${procs.running} — CPU'ya göre ilk 30)` : ''}
          </span>
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>İsim</th>
              <th>Kullanıcı</th>
              <th>CPU %</th>
              <th>RAM %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(procs?.top || []).map((p) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td title={p.command}>{p.name}</td>
                <td>{p.user}</td>
                <td>{p.cpu.toFixed(1)}</td>
                <td>{p.mem.toFixed(1)}</td>
                <td className="row-actions">
                  <button className="danger" onClick={() => killProcess(p)}>
                    Sonlandır
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
