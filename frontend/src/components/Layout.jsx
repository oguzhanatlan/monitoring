import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="logo">Sunucu Paneli</h1>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/files">Dosyalar</NavLink>
          <NavLink to="/terminal">Terminal</NavLink>
          <NavLink to="/users">Kullanıcılar</NavLink>
        </nav>
        <div className="sidebar-footer">
          <span className="dim">{user.username}</span>
          <button onClick={logout}>Çıkış</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
