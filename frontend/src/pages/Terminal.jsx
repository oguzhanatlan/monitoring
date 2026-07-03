import { useState, useRef } from 'react';
import TerminalTab from '../components/TerminalTab.jsx';

// Çoklu sekme yönetimi. Her sekmenin kendi TerminalTab bileşeni (dolayısıyla
// kendi pty'si) var. Sekme kapanınca socket kopar, backend pty'yi öldürür.
export default function Terminal() {
  const nextId = useRef(1);
  const [tabs, setTabs] = useState(() => [{ id: 0, label: 'Terminal 1' }]);
  const [activeId, setActiveId] = useState(0);

  function addTab() {
    const id = nextId.current++;
    setTabs((t) => [...t, { id, label: `Terminal ${id + 1}` }]);
    setActiveId(id);
  }

  function closeTab(id, e) {
    e?.stopPropagation();
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (activeId === id && remaining.length) {
        setActiveId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  }

  return (
    <div className="page terminal-page">
      <div className="terminal-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`terminal-tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
          >
            {t.label}
            <span className="tab-close" onClick={(e) => closeTab(t.id, e)}>
              ×
            </span>
          </div>
        ))}
        <button className="tab-add" onClick={addTab}>
          + Yeni
        </button>
      </div>

      <div className="terminal-body">
        {tabs.length === 0 ? (
          <div className="dim terminal-empty">
            Açık terminal yok. “+ Yeni” ile bir oturum başlatın.
          </div>
        ) : (
          tabs.map((t) => (
            <TerminalTab
              key={t.id}
              active={t.id === activeId}
              onExit={() => closeTab(t.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
