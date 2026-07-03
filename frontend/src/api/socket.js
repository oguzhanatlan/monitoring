import { io } from 'socket.io-client';
import { getAccessToken, refreshSession } from './client.js';

// Belirtilen namespace'e JWT ile bağlanır. Token süresi dolduğunda
// bağlantı reddedilirse bir kez sessiz refresh deneyip yeniden bağlanır.
export function connectNamespace(namespace) {
  const socket = io(namespace, {
    path: '/ws',
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelay: 2000,
  });

  socket.on('connect_error', async (err) => {
    if (/oturum/i.test(err.message)) {
      try {
        await refreshSession();
        socket.connect();
      } catch {
        socket.disconnect();
      }
    }
  });

  return socket;
}
