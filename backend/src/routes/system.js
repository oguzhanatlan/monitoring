import { Router } from 'express';
import { execFile } from 'node:child_process';
import si from 'systeminformation';
import config from '../config/config.js';
import { audit } from '../utils/audit.js';
import { destructiveLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Değişmeyen donanım/OS bilgisi — dashboard ilk açılışta bir kez çeker
router.get('/info', async (req, res) => {
  const [cpu, osInfo] = await Promise.all([si.cpu(), si.osInfo()]);
  res.json({
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed,
    },
    os: {
      platform: osInfo.platform,
      distro: osInfo.distro,
      release: osInfo.release,
      kernel: osInfo.kernel,
      hostname: osInfo.hostname,
    },
  });
});

// Anlık metrik anlık görüntüsü (canlı akış WS üzerinden; bu endpoint tekil sorgular için)
router.get('/stats', async (req, res) => {
  res.json(await collectStats());
});

router.get('/services', async (req, res) => {
  res.json(await collectServices());
});

// Process öldürme — yıkıcı işlem: hafif rate limit + audit log
router.post('/kill', destructiveLimiter, (req, res) => {
  const pid = Number(req.body?.pid);
  if (!Number.isInteger(pid) || pid <= 1) {
    return res.status(400).json({ error: 'Geçersiz PID' });
  }
  if (pid === process.pid) {
    return res.status(400).json({ error: 'Panelin kendi process\'i öldürülemez' });
  }
  try {
    process.kill(pid, 'SIGTERM');
    audit(req.user, 'system.kill', `PID ${pid} (SIGTERM)`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Process sonlandırılamadı: ${err.message}` });
  }
});

export async function collectStats() {
  const [load, mem, fsSize, netStats, disksIO, temp, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.disksIO().catch(() => null),
    si.cpuTemperature().catch(() => ({ main: null })),
    si.time(),
  ]);

  return {
    ts: Date.now(),
    cpu: {
      load: load.currentLoad,
      loadAvg: load.avgLoad != null ? [load.avgLoad] : [],
      // Linux'ta 1/5/15 dk load average os modülünden gelir
      loads: process.platform !== 'win32' ? (await import('node:os')).loadavg() : [0, 0, 0],
      perCore: load.cpus.map((c) => c.load),
      temp: temp.main,
    },
    mem: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    disks: fsSize
      .filter((d) => d.size > 0)
      .map((d) => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: d.use })),
    diskIO: disksIO ? { read: disksIO.rIO_sec, write: disksIO.wIO_sec } : null,
    network: netStats.map((n) => ({
      iface: n.iface,
      rxSec: n.rx_sec,
      txSec: n.tx_sec,
      rxTotal: n.rx_bytes,
      txTotal: n.tx_bytes,
    })),
    uptime: time.uptime,
  };
}

export async function collectProcesses() {
  const procs = await si.processes();
  const top = procs.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 30)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: p.cpu,
      mem: p.mem,
      user: p.user,
      command: (p.command || '').slice(0, 120),
    }));
  return { all: procs.all, running: procs.running, top };
}

export function collectServices() {
  if (config.monitoredServices.length === 0 || process.platform === 'win32') {
    return Promise.resolve([]);
  }
  return Promise.all(
    config.monitoredServices.map(
      (name) =>
        new Promise((resolve) => {
          execFile('systemctl', ['is-active', name], (err, stdout) => {
            resolve({ name, status: (stdout || '').trim() || 'unknown' });
          });
        })
    )
  );
}

// Canlı akış: /system namespace'ine bağlı istemci varken 2 sn'de bir metrik,
// 6 sn'de bir process listesi ve servis durumu yayınlanır. Kimse yokken durur.
export function registerSystemNamespace(io, socketAuthMiddleware) {
  const ns = io.of('/system');
  ns.use(socketAuthMiddleware);

  let statsTimer = null;
  let procsTimer = null;

  function start() {
    if (statsTimer) return;
    statsTimer = setInterval(async () => {
      try {
        ns.emit('stats', await collectStats());
      } catch (err) {
        console.error('Metrik toplanamadı:', err.message);
      }
    }, 2000);
    procsTimer = setInterval(async () => {
      try {
        const [procs, services] = await Promise.all([collectProcesses(), collectServices()]);
        ns.emit('processes', procs);
        ns.emit('services', services);
      } catch (err) {
        console.error('Process listesi toplanamadı:', err.message);
      }
    }, 6000);
  }

  function stopIfEmpty() {
    if (ns.sockets.size === 0 && statsTimer) {
      clearInterval(statsTimer);
      clearInterval(procsTimer);
      statsTimer = null;
      procsTimer = null;
    }
  }

  ns.on('connection', async (socket) => {
    start();
    // Yeni bağlanan beklemesin: eldeki veriyi hemen gönder
    try {
      socket.emit('stats', await collectStats());
      const [procs, services] = await Promise.all([collectProcesses(), collectServices()]);
      socket.emit('processes', procs);
      socket.emit('services', services);
    } catch {
      // ilk yükleme başarısızsa periyodik yayın telafi eder
    }
    socket.on('disconnect', stopIfEmpty);
  });
}

export default router;
