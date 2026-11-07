# Servidor de ¿Dónde queda...?

Un único VPS hace todo:

```
Móvil / navegador ──HTTPS──▶ Apache (443) ──┬─▶ /          el juego (carpeta www del repo)
                                            ├─▶ /api/...   ranking e historial ─┐
                                            └─▶ /ws        partidas online ─────┴─▶ Node (127.0.0.1:3000)
                                                                                     └─▶ SQLite /var/lib/donde/donde.db
cron (cada minuto, usuario deploy) ─▶ deploy/actualizar.sh ─▶ git reset a la rama + reinicia Node si cambió server/
cron (4:37, usuario donde)          ─▶ server/backup.js      ─▶ copia comprimida en /var/lib/donde/copias (7 días)
```

## Por qué hacía falta HTTPS

El navegador **bloquea el GPS y la brújula** en páginas `http://`, y la app de Android/iOS
bloquea las conexiones sin cifrar. Sin certificado, el juego carga pero no se puede jugar.

Let's Encrypt da certificados gratis **para la IP**, sin necesidad de dominio (desde 2026,
con certbot 5.4+). Duran 6 días y certbot los renueva solo.

## Instalación (una sola vez)

En el servidor, como root, desde la carpeta del repo (`/var/www/testing`):

```bash
cd /var/www/testing
git fetch origin testing && git reset --hard origin/testing   # asegúrate de tener esta rama
bash deploy/instalar-servidor.sh 217.72.207.119
```

Antes, en el panel del proveedor del VPS, comprueba que los puertos **80 y 443** están abiertos
(el 80 lo usa Let's Encrypt para comprobar que el servidor es tuyo).

Al terminar: abre `https://217.72.207.119/api/health` → debe responder `{"ok":true,...}`.

El instalador termina llamando a `deploy/endurecer.sh` (ver **Seguridad**). En un servidor
ya instalado, basta con ejecutar ese script una vez: `bash /var/www/testing/deploy/endurecer.sh`.

## Seguridad

| Qué | Cómo |
|---|---|
| Cuentas | Cada móvil tiene un id privado y una **clave secreta** que le da el servidor. En la BD solo está su hash (SHA-256). Sin la clave no se puede jugar con la cuenta de otro ni ver su historial. |
| Ids | Los demás jugadores solo ven un **alias** (`publicId`), que no sirve para entrar como tú. |
| Anti-abuso | IP real (Apache escribe `X-Real-IP`; no se puede falsificar). 12 conexiones y 3 salas abiertas por IP, 60 mensajes cada 10 s, 60 peticiones/min a `/api`. Abrir el modo online no guarda nada. |
| Despliegue | El cron corre como `deploy` (dueño del repo, no root). Solo puede hacer `systemctl restart donde` (`/etc/sudoers.d/donde-deploy`). Sin token de GitHub en el servidor. |
| Servicio | `donde` corre como usuario sin privilegios, sin red hacia fuera (solo 127.0.0.1), sin capacidades y sin poder escribir fuera de `/var/lib/donde` (`donde-endurecido.conf`). |
| Datos | `/var/lib/donde` es 700 y la BD 600: solo la lee el servicio. Copia diaria con prioridad mínima. |
| VPS | ufw (solo SSH, 80 y 443), fail2ban para SSH, actualizaciones de seguridad automáticas, Apache sin versión a la vista. |

Nada de esto gasta CPU durante las partidas: son límites en memoria y reglas que aplica el
núcleo al arrancar el servicio.

## Cómo funciona una partida online

1. Un jugador pulsa **Ranked** (o **Local**) → **Crear sala**, elige región y ubicación. Le sale un código de 4 letras.
2. Los demás (hasta 10 en total) pulsan **Unirse**, escriben el código y eligen su ubicación.
3. El anfitrión (👑) pulsa **Empezar**. El servidor elige los 10 destinos (nunca el país de ningún jugador).
4. En cada ronda todos ven el mismo destino a la vez y tienen 15 s. El móvil **solo manda el rumbo**:
   el servidor calcula el acierto con el mismo código que el juego (`www/shot.js`) y reparte los puntos.
5. Cuando todos han disparado se ven los resultados de todos; con todos en "Siguiente" (o a los 30 s) sigue.
6. Al final todo queda guardado en la base de datos y aparece en el **ranking online mundial**.

Si alguien pierde la conexión, el móvil reconecta solo y vuelve a la ronda en la que estaba.
En iPhone, al bloquear la pantalla iOS congela la conexión sin cerrarla: el móvil lo detecta
(ping cada 5 s, comprobación al volver a la app y al acabarse el tiempo) y se reconecta.
Si alguien se va, la partida sigue sin esperarle.

## Base de datos

`/var/lib/donde/donde.db` (fuera del repo: el cron nunca la toca). Solo guarda **Ranked**.
Su tamaño está acotado: unos 4 KB por jugador de Ranked, juegue las partidas que juegue.

| Tabla | Qué guarda |
|---|---|
| `players` | cada jugador de Ranked: nombre, hash de su clave, MMR, rango y totales (victorias, mejor puntuación, aciertos). Se crea al empezar su primera Ranked |
| `matches` | las partidas Ranked terminadas (las que no se terminan se borran) |
| `match_players` | quién jugó, puntos, puesto y LP. **Solo las últimas 20 de cada jugador** |
| `target_stats` | por destino: cuántos disparos y cuántos aciertos |

No se guarda **dónde estaba nadie** ni cada disparo suelto.

```bash
sqlite3 /var/lib/donde/donde.db "SELECT name, shots, hits FROM target_stats ORDER BY 1.0*hits/shots LIMIT 10;"  # los más difíciles
ls -lh /var/lib/donde/copias                         # copias de seguridad (7 días)
sudo -u donde node /var/www/testing/server/backup.js # hacer una copia ya
```
Para restaurar una copia, mira las instrucciones al principio de `server/backup.js`.

## Comandos útiles

```bash
systemctl status donde                 # ¿está en marcha?
journalctl -u donde -f                 # registro en directo
tail -f /var/log/donde-actualizar.log  # qué ha traído el cron
certbot certificates                   # estado del certificado
sudo -u deploy -H /var/www/testing/deploy/actualizar.sh   # forzar una actualización ya
```

Reiniciar el servidor corta las partidas en curso (no cuentan y no se guardan).
Si un reinicio falla, el cron lo vuelve a intentar al minuto siguiente.
El cron solo lo reinicia cuando cambia algo de `server/`, `www/shot.js` o `www/data.js`.

## Si algún día tenéis dominio

Crea un registro A del dominio a la IP y ejecuta `certbot --apache -d juego.tudominio.com`.
Luego cambia `SERVER_URL` en `www/online.js` y `PUBLIC_ORIGIN` en `/etc/donde.env`.

## Probar en local

```bash
cd server && npm install && npm test     # simula una partida completa de 3 jugadores
npm start                                # servidor en http://127.0.0.1:3000
```

### Local y Ranked

Las dos usan salas con código. **Ranked** guarda la partida y el LP
en la base de datos. **Local** cuenta los puntos para anunciar al ganador, pero no
guarda nada. Un código de una sala Ranked no vale desde Local, ni al revés.
