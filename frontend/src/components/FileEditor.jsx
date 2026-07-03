import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import api from '../api/client.js';

// Uzantıya göre sözdizimi vurgulama seçer
function languageFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return [javascript()];
  if (ext === 'json') return [json()];
  if (['html', 'htm'].includes(ext)) return [html()];
  if (['css', 'scss'].includes(ext)) return [css()];
  if (['py'].includes(ext)) return [python()];
  if (['md', 'markdown'].includes(ext)) return [markdown()];
  return [];
}

export default function FileEditor({ path, onClose, onError }) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/files/content', { params: { path } })
      .then((res) => {
        if (cancelled) return;
        setContent(res.data.content);
        setOriginal(res.data.content);
      })
      .catch((err) => {
        onError?.(err.response?.data?.error || 'Dosya açılamadı');
        onClose();
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function save() {
    setSaving(true);
    try {
      await api.put('/files/content', { path, content });
      setOriginal(content);
    } catch (err) {
      onError?.(err.response?.data?.error || 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const dirty = content !== original;

  return (
    <div className="page">
      <div className="editor-header">
        <button
          onClick={() => {
            if (dirty && !confirm('Kaydedilmemiş değişiklikler var. Çıkılsın mı?')) return;
            onClose();
          }}
        >
          ← Geri
        </button>
        <span className="mono editor-path">{path}</span>
        <button onClick={save} disabled={!dirty || saving}>
          {saving ? 'Kaydediliyor…' : dirty ? 'Kaydet' : 'Kaydedildi'}
        </button>
      </div>
      {loading ? (
        <p className="dim">Yükleniyor…</p>
      ) : (
        <CodeMirror
          value={content}
          height="calc(100vh - 160px)"
          theme="dark"
          extensions={languageFor(path)}
          onChange={setContent}
        />
      )}
    </div>
  );
}
