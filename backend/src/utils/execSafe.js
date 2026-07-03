import { execFile } from 'node:child_process';

/**
 * execFile'ı Promise'a saran güvenli yardımcı. Kabuk YOK (argüman dizisi ile
 * çağrılır) — shell enjeksiyonuna kapalıdır. Hata/timeout durumunda fırlatmaz,
 * { ok:false, error } döner; böylece çağıran endpoint her zaman graceful yanıt verir.
 *
 * @param {string} cmd - çalıştırılacak program (örn. 'ufw', 'systemctl')
 * @param {string[]} args - argümanlar (kullanıcı girdisi ASLA komuta gömülmez)
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<{ok:boolean, stdout?:string, stderr?:string, error?:string}>}
 */
export function execSafe(cmd, args = [], timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, stdout: stdout || '', stderr: stderr || '' });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}
