import axios from 'axios';

// Access token SADECE bellekte tutulur (XSS'e karşı localStorage kullanılmaz).
// Refresh token'ı tarayıcı httpOnly cookie olarak taşır, JS hiç görmez.
let accessToken = null;
let onSessionExpired = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Aynı anda birden çok 401 gelirse tek refresh isteği yapılır, diğerleri bekler
let refreshPromise = null;

export async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh', null, { withCredentials: true })
      .then((res) => {
        accessToken = res.data.accessToken;
        return res.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    // Access token süresi dolduysa bir kez sessizce yenileyip isteği tekrarla
    if (status === 401 && !original._retried && !original.url.startsWith('/auth/')) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        onSessionExpired();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
