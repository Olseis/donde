#!/usr/bin/env bash
# ==========================================================
#  Instalación del servidor de ¿Dónde queda...?  (Ubuntu/Debian, como root)
#
#  Uso, desde la carpeta del repo en el servidor:
#     bash deploy/instalar-servidor.sh                 # detecta la IP pública
#     bash deploy/instalar-servidor.sh 217.72.207.119  # o se la das tú
#     bash deploy/instalar-servidor.sh 217.72.207.119 tu@correo.com
#
#  Qué hace:
#   1. Instala Apache, Node.js y certbot (versión nueva, que ya admite IPs)
#   2. Saca un certificado HTTPS gratuito de Let's Encrypt para la IP
#   3. Configura Apache: el juego por HTTPS y /api y /ws hacia Node
#   4. Crea el servicio "donde" (Node + base de datos SQLite) que arranca solo
#   5. Cambia el cron viejo por deploy/actualizar.sh
#   6. Endurece el servidor (deploy/endurecer.sh): cron sin root, servicio
#      encerrado, copias diarias, cortafuegos y fail2ban
#
#  Se puede volver a ejecutar sin problema: lo que ya está hecho lo deja igual.
# ==========================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo testing)"
[ "$BRANCH" = "HEAD" ] && BRANCH=testing
IP="${1:-}"
EMAIL="${2:-}"
WEBROOT=/var/www/letsencrypt
DATA_DIR=/var/lib/donde

paso() { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
fallo(){ echo -e "\n\033[1;31m✗ $*\033[0m"; exit 1; }

[ "$(id -u)" -eq 0 ] || fallo "Ejecútalo como root."
[ -f "$REPO_DIR/server/index.js" ] || fallo "No encuentro server/index.js en $REPO_DIR. ¿Está la rama con el servidor?"

if [ -z "$IP" ]; then
  IP="$(curl -4 -fsS https://ifconfig.me || true)"
  [ -n "$IP" ] || fallo "No pude averiguar la IP pública. Pásala como primer argumento."
fi
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fallo "\"$IP\" no parece una IPv4."
echo "Repo: $REPO_DIR (rama $BRANCH) · IP: $IP"

# ----------------------------------------------------------
paso "1/6 Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq apache2 git curl ca-certificates build-essential python3 snapd >/dev/null
ok "Apache y herramientas"

NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v)"

# El certbot de apt es viejo: los certificados para IP necesitan la 5.4 o superior
if dpkg -l certbot 2>/dev/null | grep -q '^ii'; then
  apt-get remove -y -qq certbot >/dev/null
fi
snap install core >/dev/null 2>&1 || true
snap refresh core >/dev/null 2>&1 || true
snap install --classic certbot >/dev/null 2>&1 || snap refresh certbot >/dev/null 2>&1 || true
if [ -x /snap/bin/certbot ]; then
  ln -sf /snap/bin/certbot /usr/bin/certbot
else
  # Algunos VPS (contenedores) no tienen snap: se instala con pip en un entorno aparte
  apt-get install -y -qq python3-venv >/dev/null
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install -q --upgrade pip certbot
  ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
  # Sin snap no hay temporizador de renovación: se añade al cron
  echo "0 */12 * * * root /opt/certbot/bin/certbot renew -q" > /etc/cron.d/certbot-renew
fi
CB_VER=$(certbot --version 2>&1 | awk '{print $2}')
if [ "$(printf '%s\n' 5.4 "$CB_VER" | sort -V | head -1)" != "5.4" ]; then
  fallo "certbot $CB_VER es demasiado viejo (hace falta 5.4+). Prueba: snap refresh certbot"
fi
ok "certbot $CB_VER"

# ----------------------------------------------------------
paso "2/6 Servidor de partidas (Node + SQLite)"
id donde >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin donde
mkdir -p "$DATA_DIR"
chown donde:donde "$DATA_DIR"
chmod 700 "$DATA_DIR"

cat > /etc/donde.env <<EOF
# Configuración del servidor de ¿Dónde queda...? (la lee systemd y deploy/actualizar.sh)
PORT=3000
DB_PATH=$DATA_DIR/donde.db
PUBLIC_ORIGIN=https://$IP
REPO_DIR=$REPO_DIR
BRANCH=$BRANCH
EOF

(cd "$REPO_DIR/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
sed "s#__REPO__#$REPO_DIR#g" "$REPO_DIR/deploy/donde.service" > /etc/systemd/system/donde.service
systemctl daemon-reload
systemctl enable --now donde >/dev/null 2>&1
systemctl restart donde
sleep 2
curl -fsS http://127.0.0.1:3000/api/health >/dev/null || fallo "El servidor no arranca. Mira: journalctl -u donde -n 50"
ok "Servicio donde en marcha (base de datos en $DATA_DIR/donde.db)"

# ----------------------------------------------------------
paso "3/6 Apache (primero solo HTTP, para poder pedir el certificado)"
a2enmod ssl proxy proxy_http proxy_wstunnel headers rewrite >/dev/null
mkdir -p "$WEBROOT/.well-known/acme-challenge"
cat > /etc/apache2/sites-available/donde-http.conf <<EOF
<VirtualHost *:80>
    ServerName $IP
    DocumentRoot $REPO_DIR/www
    Alias /.well-known/acme-challenge/ $WEBROOT/.well-known/acme-challenge/
    <Directory $WEBROOT>
        Require all granted
    </Directory>
</VirtualHost>
EOF
a2dissite -q 000-default donde >/dev/null 2>&1 || true
a2ensite -q donde-http >/dev/null
apache2ctl configtest
systemctl reload apache2
ok "Apache escuchando en el puerto 80"

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ok "Firewall: abiertos 80 y 443"
fi

# ----------------------------------------------------------
paso "4/6 Certificado HTTPS de Let's Encrypt para $IP"
if [ -n "$EMAIL" ]; then MAIL_ARGS=(-m "$EMAIL"); else MAIL_ARGS=(--register-unsafely-without-email); fi
# Los certificados de IP duran 6 días; certbot los renueva solo (dos veces al día lo comprueba)
certbot certonly --non-interactive --agree-tos "${MAIL_ARGS[@]}" \
  --webroot --webroot-path "$WEBROOT" \
  --preferred-profile shortlived \
  --ip-address "$IP" \
  --deploy-hook "systemctl reload apache2" \
  --keep-until-expiring
[ -f "/etc/letsencrypt/live/$IP/fullchain.pem" ] || fallo "No se creó el certificado. Revisa que el puerto 80 esté abierto en el panel del VPS."
ok "Certificado en /etc/letsencrypt/live/$IP/"
systemctl list-timers 2>/dev/null | grep -q certbot && ok "Renovación automática activa" || true

# ----------------------------------------------------------
paso "5/6 Apache con HTTPS"
sed -e "s#__IP__#$IP#g" -e "s#__WWW__#$REPO_DIR/www#g" \
  "$REPO_DIR/deploy/apache-donde.conf" > /etc/apache2/sites-available/donde.conf
a2dissite -q donde-http >/dev/null
a2ensite -q donde >/dev/null
apache2ctl configtest
systemctl reload apache2
ok "https://$IP sirve el juego, /api y /ws"

# ----------------------------------------------------------
paso "6/6 Cron de actualización y endurecimiento"
chmod +x "$REPO_DIR/deploy/actualizar.sh" "$REPO_DIR/deploy/endurecer.sh"
# Quitar la línea vieja del crontab de root (la del git reset) si existe
if crontab -l 2>/dev/null | grep -q "git reset"; then
  crontab -l | grep -v "git reset" | crontab -
  ok "Quitado el cron viejo de crontab -e"
fi
bash "$REPO_DIR/deploy/endurecer.sh"

# ----------------------------------------------------------
echo
if curl -fsS "https://$IP/api/health" >/dev/null; then
  echo -e "\033[1;32m✔ Todo listo.\033[0m"
else
  echo -e "\033[1;33m⚠ Instalado, pero https://$IP/api/health no responde desde aquí. Prueba desde el móvil.\033[0m"
fi
cat <<EOF

  Juego:          https://$IP
  Comprobación:   https://$IP/api/health
  Ranking online: https://$IP/api/online/ranking

  Ver el servidor en directo:   journalctl -u donde -f
  Ver las actualizaciones:      tail -f /var/log/donde-actualizar.log
  Base de datos:                sqlite3 $DATA_DIR/donde.db
EOF
