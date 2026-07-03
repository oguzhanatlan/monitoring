import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { connectNamespace } from '../api/socket.js';

// Tek bir terminal sekmesi = bir xterm + bir socket + bir pty.
// active=false iken DOM'da kalır (görünmez) ki sekme değişince oturum kopmasın.
export default function TerminalTab({ active, onExit }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 14,
      theme: { background: '#0f172a', foreground: '#e2e8f0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const socket = connectNamespace('/terminal');
    socketRef.current = socket;

    socket.on('connect', () => {
      fit.fit();
      socket.emit('resize', { cols: term.cols, rows: term.rows });
    });
    socket.on('output', (data) => term.write(data));
    socket.on('exit', (msg) => {
      term.write(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
      onExit?.();
    });

    term.onData((data) => socket.emit('input', data));
    term.onResize(({ cols, rows }) => socket.emit('resize', { cols, rows }));

    const onWinResize = () => fit.fit();
    window.addEventListener('resize', onWinResize);

    return () => {
      window.removeEventListener('resize', onWinResize);
      socket.disconnect();
      term.dispose();
    };
  }, []);

  // Sekme aktifleşince yeniden boyutlandır ve odaklan
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        fitRef.current.fit();
        termRef.current?.focus();
        socketRef.current?.emit('resize', {
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        });
      }, 0);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}
