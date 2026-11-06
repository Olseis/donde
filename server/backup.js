/* =======================================
   COPIA DE SEGURIDAD DE LA BASE DE DATOS

   La lanza el cron una vez al día de madrugada (ver deploy/endurecer.sh),
   con prioridad mínima de CPU y disco para no molestar a las partidas.
   Hace una copia en caliente (el servidor sigue funcionando), la comprime
   y guarda las últimas 7 en /var/lib/donde/copias.

   Uso a mano:  node server/backup.js
   Restaurar:   systemctl stop donde
                gunzip -c /var/lib/donde/copias/donde-AAAA-MM-DD.db.gz > /var/lib/donde/donde.db
                rm -f /var/lib/donde/donde.db-wal /var/lib/donde/donde.db-shm
                chown donde:donde /var/lib/donde/donde.db && systemctl start donde
   ======================================= */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "/var/lib/donde/donde.db";
const DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "copias");
const KEEP = Number(process.env.BACKUP_KEEP) || 7;

(async () => {
  process.umask(0o077);
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const day = new Date().toISOString().slice(0, 10);
  const tmp = path.join(DIR, `.donde-${day}.db`);
  const out = path.join(DIR, `donde-${day}.db.gz`);

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  await db.backup(tmp); // copia consistente aunque el servidor esté escribiendo
  db.close();
  await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(out));
  fs.unlinkSync(tmp);

  // Borra las más antiguas
  const all = fs.readdirSync(DIR).filter((f) => /^donde-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(DIR, f));

  console.log(`[${new Date().toISOString()}] Copia ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB), guardadas ${Math.min(all.length, KEEP)}`);
})().catch((e) => {
  console.error(`[${new Date().toISOString()}] Error en la copia:`, e.message);
  process.exit(1);
});
