import { useEffect, useState, useCallback, useRef } from 'react';
import api, { getAccessToken } from '../api/client.js';
import FileEditor from '../components/FileEditor.jsx';

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function joinPath(dir, name) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

export default function FileManager() {
  const [roots, setRoots] = useState([]);
  const [cwd, setCwd] = useState(null);
  const [listing, setListing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { path }
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/files/roots').then((res) => {
      setRoots(res.data.roots);
      if (res.data.roots.length) setCwd(res.data.roots[0]);
    });
  }, []);

  const load = useCallback(async (dir) => {
    setError('');
    try {
      const res = await api.get('/files', { params: { path: dir } });
      setListing(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err.response?.data?.error || 'Klasör açılamadı');
    }
  }, []);

  useEffect(() => {
    if (cwd) load(cwd);
  }, [cwd, load]);

  function open(item) {
    if (item.isDir) setCwd(item.path);
    else setEditing({ path: item.path });
  }

  function toggleSelect(item, e) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(item.path) ? next.delete(item.path) : next.add(item.path);
      return next;
    });
  }

  function handleError(err, fallback) {
    setError(err.response?.data?.error || fallback);
  }

  async function doDelete() {
    const paths = [...selected];
    if (paths.length === 0) return;
    if (!confirm(`${paths.length} öğe silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await api.delete('/files', { data: { paths } });
      load(cwd);
    } catch (err) {
      handleError(err, 'Silme başarısız');
    }
  }

  async function newFolder() {
    const name = prompt('Yeni klasör adı:');
    if (!name) return;
    try {
      await api.post('/files/mkdir', { path: joinPath(cwd, name) });
      load(cwd);
    } catch (err) {
      handleError(err, 'Klasör oluşturulamadı');
    }
  }

  async function newFile() {
    const name = prompt('Yeni dosya adı:');
    if (!name) return;
    try {
      await api.post('/files/touch', { path: joinPath(cwd, name) });
      load(cwd);
    } catch (err) {
      handleError(err, 'Dosya oluşturulamadı');
    }
  }

  async function rename(item) {
    const name = prompt('Yeni ad:', item.name);
    if (!name || name === item.name) return;
    try {
      await api.post('/files/rename', { from: item.path, to: joinPath(cwd, name) });
      load(cwd);
    } catch (err) {
      handleError(err, 'Yeniden adlandırma başarısız');
    }
  }

  async function unzip(item) {
    try {
      await api.post('/files/unzip', { path: item.path });
      load(cwd);
    } catch (err) {
      handleError(err, 'Arşiv açılamadı');
    }
  }

  // İndirme: axios interceptor Authorization ekleyemediği <a> yerine
  // fetch ile blob indiriyoruz (access token bellekte)
  async function download(item, asZip = false) {
    setError('');
    try {
      const url = asZip
        ? `/api/files/download-zip?path=${encodeURIComponent(item.path)}`
        : `/api/files/download?path=${encodeURIComponent(item.path)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = asZip ? `${item.name}.zip` : item.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('İndirme başarısız');
    }
  }

  async function uploadFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const form = new FormData();
    for (const f of fileList) form.append('files', f);
    setError('');
    try {
      await api.post('/files/upload', form, { params: { path: cwd } });
      load(cwd);
    } catch (err) {
      handleError(err, 'Yükleme başarısız');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }

  if (editing) {
    return <FileEditor path={editing.path} onClose={() => setEditing(null)} onError={setError} />;
  }

  return (
    <div className="page">
      <h2>Dosyalar</h2>
      {error && <p className="error">{error}</p>}

      <div className="fm-toolbar">
        <select value={cwd || ''} onChange={(e) => setCwd(e.target.value)}>
          {roots.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button onClick={() => listing && setCwd(listing.parent)} disabled={!listing}>
          ↑ Üst klasör
        </button>
        <button onClick={newFolder}>+ Klasör</button>
        <button onClick={newFile}>+ Dosya</button>
        <button onClick={() => fileInputRef.current?.click()}>Yükle</button>
        <button className="danger" onClick={doDelete} disabled={selected.size === 0}>
          Sil ({selected.size})
        </button>
        <input
          type="file"
          multiple
          hidden
          ref={fileInputRef}
          onChange={(e) => {
            uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="fm-path">{listing?.path}</div>

      <div
        className={`fm-list ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>İsim</th>
              <th>Boyut</th>
              <th>İzinler</th>
              <th>Değiştirilme</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(listing?.items || []).map((item) => (
              <tr key={item.path} onDoubleClick={() => open(item)}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(item.path)}
                    onChange={(e) => toggleSelect(item, e)}
                  />
                </td>
                <td className="fm-name" onClick={() => open(item)}>
                  <span className="fm-icon">{item.isDir ? '📁' : item.isSymlink ? '🔗' : '📄'}</span>
                  {item.name}
                </td>
                <td>{item.isDir ? '—' : formatBytes(item.size)}</td>
                <td className="mono">{item.mode}</td>
                <td className="dim small">{item.mtime ? new Date(item.mtime).toLocaleString() : '—'}</td>
                <td className="row-actions">
                  {!item.isDir && <button onClick={() => download(item)}>İndir</button>}
                  {item.isDir && <button onClick={() => download(item, true)}>Zip indir</button>}
                  {!item.isDir && item.name.endsWith('.zip') && (
                    <button onClick={() => unzip(item)}>Aç</button>
                  )}
                  <button onClick={() => rename(item)}>Ad değiştir</button>
                </td>
              </tr>
            ))}
            {listing?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="dim" style={{ textAlign: 'center' }}>
                  Bu klasör boş — dosya sürükleyip bırakarak yükleyebilirsiniz
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
