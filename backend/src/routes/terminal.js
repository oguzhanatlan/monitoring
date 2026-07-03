import pty from 'node-pty';
import os from 'node:os';
import config from '../config/config.js';
import { audit } from '../utils/audit.js';

// Web terminal: /ws üzerinden /terminal namespace'i. JWT handshake doğrulaması
// zorunlu (socketAuthMiddleware). Her Socket.io bağlantısı bir shell process açar;
// bağlantı kopunca process öldürülür (zombie bırakılmaz).
//
// Çoklu sekme: frontend her sekme için ayrı bir socket bağlantısı kurar, böylece
// her sekmenin izole bir pty'si olur.

const isWindows = process.platform === 'win32';
const shell = isWindows ? 'powershell.exe' : config.terminalShell;

export function registerTerminalNamespace(io, socketAuthMiddleware) {
  const ns = io.of('/terminal');
  ns.use(socketAuthMiddleware);

  ns.on('connection', (socket) => {
    let term;
    try {
      term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (err) {
      socket.emit('exit', `Terminal başlatılamadı: ${err.message}`);
      socket.disconnect();
      return;
    }

    audit(socket.user, 'terminal.open', `shell: ${shell}`, socket.handshake.address);

    // pty -> tarayıcı
    term.onData((data) => socket.emit('output', data));

    // pty kapanınca istemciye bildir ve bağlantıyı kapat
    term.onExit(({ exitCode }) => {
      socket.emit('exit', `Oturum sonlandı (kod ${exitCode})`);
      socket.disconnect();
    });

    // tarayıcı -> pty
    socket.on('input', (data) => {
      if (typeof data === 'string') term.write(data);
    });

    socket.on('resize', ({ cols, rows } = {}) => {
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
        try {
          term.resize(cols, rows);
        } catch {
          // resize başarısız olursa oturum devam etsin
        }
      }
    });

    // Bağlantı kopunca pty process'ini kesin olarak sonlandır (zombie önleme)
    socket.on('disconnect', () => {
      audit(socket.user, 'terminal.close', null, socket.handshake.address);
      try {
        term.kill();
      } catch {
        // zaten ölmüş olabilir
      }
    });
  });
}
