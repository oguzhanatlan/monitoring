import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useTheme } from '../theme.js';

// macOS SF Symbols yerine basit inline SVG ikonlar
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6" /><path d="M18 20a5.5 5.5 0 0 0-3-4.9" />
    </svg>
  ),
};

const NAV = [
  { to: '/', end: true, label: 'Dashboard', icon: 'dashboard' },
  { to: '/files', label: 'Dosyalar', icon: 'files' },
  { to: '/terminal', label: 'Terminal', icon: 'terminal' },
  { to: '/security', label: 'Güvenlik', icon: 'security' },
  { to: '/users', label: 'Kullanıcılar', icon: 'users' },
];

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/files': 'Dosyalar',
  '/terminal': 'Terminal',
  '/security': 'Güvenlik',
  '/users': 'Kullanıcılar',
};

function ThemeSwitch() {
  const [pref, setTheme] = useTheme();
  const opts = [
    { v: 'system', label: 'Oto' },
    { v: 'light', label: 'Açık' },
    { v: 'dark', label: 'Koyu' },
  ];
  return (
    <div className="segmented theme-switch" role="tablist" aria-label="Tema">
      {opts.map((o) => (
        <button
          key={o.v}
          className={pref === o.v ? 'active' : ''}
          onClick={() => setTheme(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Panel';

  return (
    <div className="mac-window">
      {/* Pencere başlık çubuğu — trafik ışıkları (dekoratif) */}
      <div className="titlebar">
        <div className="traffic-lights" aria-hidden="true">
          <span className="tl red" />
          <span className="tl yellow" />
          <span className="tl green" />
        </div>
        <div className="titlebar-title">{title}</div>
        <div className="titlebar-right">
          <ThemeSwitch />
        </div>
      </div>

      <div className="mac-body">
        <aside className="sidebar">
          <div className="sidebar-brand">Sunucu Paneli</div>
          <nav>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <span className="nav-icon">{icons[n.icon]}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="user-chip">
              <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{user.username}</span>
            </div>
            <button className="ghost" onClick={logout}>
              Çıkış
            </button>
          </div>
        </aside>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
