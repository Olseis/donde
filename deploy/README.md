# Servidor de ¿Dónde queda...?

Un único VPS hace todo:

```
Móvil / navegador ──HTTPS──▶ Apache (443) ──┬─▶ /          el juego (carpeta www del repo)
                                            ├─▶ /api/...   ranking e historial ─┐
                                            └─▶ /ws        partidas online ─────┴─▶ Node (127.0.0.1:3000)
                                                                                     └─▶ SQLite /var/lib/donde/donde.db
cron (cada minuto) ─▶ deploy/actualizar.sh ─▶ git reset a la rama + reinicia Node si cambió server/
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

## Cómo funciona una partida online

1. Un jugador pulsa **Online → Crear sala**, elige región y ubicación. Le sale un código de 4 letras.
2. Los demás (hasta 10 en total) pulsan **Unirse**, escriben el código y eligen su ubicación.
3. El anfitrión (👑) pulsa **Empezar**. El servidor elige los 10 destinos (nunca el país de ningún jugador).
4. En cada ronda todos ven el mismo destino a la vez y tienen 60 s. El móvil **solo manda el rumbo**:
   el servidor calcula el acierto con el mismo código que el juego (`www/shot.js`) y reparte los puntos.
5. Cuando todos han disparado se ven los resultados de todos; con todos en "Siguiente" (o a los 30 s) sigue.
6. Al final todo queda guardado en la base de datos y aparece en el **ranking online mundial**.

Si alguien pierde la conexión, el móvil reconecta solo y vuelve a la ronda en la que estaba.
Si alguien se va, la partida sigue sin esperarle.

## Base de datos

`/var/lib/donde/donde.db` (fuera del repo: el cron nunca la toca).

| Tabla | Qué guarda |
|---|---|
| `players` | cada móvil (id anónimo) y su último nombre |
| `matches` | cada partida: sala, región, estado (`playing`, `finished`, `abandoned`) |
| `match_players` | quién jugó, puntos, aciertos y puesto |
| `rounds` | el destino de cada ronda |
| `shots` | cada disparo: rumbo, ubicación, acierto, puntos y distancia |

```bash
sqlite3 /var/lib/donde/donde.db "SELECT name, score, position FROM match_players ORDER BY rowid DESC LIMIT 10;"
cp /var/lib/donde/donde.db ~/copia-$(date +%F).db     # copia de seguridad
```

## Comandos útiles

```bash
systemctl status donde                 # ¿está en marcha?
journalctl -u donde -f                 # registro en directo
tail -f /var/log/donde-actualizar.log  # qué ha traído el cron
certbot certificates                   # estado del certificado
bash deploy/actualizar.sh              # forzar una actualización ya
```

Reiniciar el servidor corta las partidas en curso (quedan como `abandoned`).
El cron solo lo reinicia cuando cambia algo de `server/`, `www/shot.js` o `www/data.js`.

## Si algún día tenéis dominio

Crea un registro A del dominio a la IP y ejecuta `certbot --apache -d juego.tudominio.com`.
Luego cambia `SERVER_URL` en `www/online.js` y `PUBLIC_ORIGIN` en `/etc/donde.env`.

## Probar en local

```bash
cd server && npm install && npm test     # simula una partida completa de 3 jugadores
npm start                                # servidor en http://127.0.0.1:3000
```
