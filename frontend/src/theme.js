import { useState, useEffect, useCallback } from 'react';

// Tema tercihi: 'system' | 'light' | 'dark'. Yalnızca görsel tercih olduğu için
// localStorage kullanmak güvenli (hassas veri değil).
const KEY = 'panel-theme';

export function getStoredTheme() {
  return localStorage.getItem(KEY) || 'system';
}

// data-theme özniteliğini kök elemana uygular. 'system' iken özniteliği kaldırır
// → CSS @media (prefers-color-scheme) devreye girer.
export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', pref);
  }
}

// Gerçekte hangi tema aktif (xterm gibi CSS bilmeyen bileşenler için)
export function resolveTheme(pref = getStoredTheme()) {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

export function useTheme() {
  const [pref, setPref] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(pref);
    localStorage.setItem(KEY, pref);
  }, [pref]);

  // Sistem teması değişince ('system' modundayken) yeniden render için dinle
  const [, force] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => force((n) => n + 1);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((p) => setPref(p), []);
  return [pref, setTheme, resolveTheme(pref)];
}
