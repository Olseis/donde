#!/usr/bin/env bash
# ==========================================================
#  Endurecimiento del VPS de ¿Dónde queda...?  (como root, una vez)
#
#  Uso, en el servidor:
#     bash /var/www/testing/deploy/endurecer.sh
#
#  Qué hace (nada de esto resta rendimiento a las partidas):
#   1. Despliegue sin root: usuario "deploy" dueño del repo; el cron corre
#      como él y solo puede reiniciar el servicio. Fuera el token de GitHub.
#   2. Servicio "donde" encerrado: sin red hacia fuera, sin permisos especiales
#   3. Base de datos solo legible por el servicio, y copia diaria de madrugada
#   4. Apache sin versión a la vista, X-Real-IP para los límites anti-abuso
#   5. Cortafuegos (ufw): solo SSH, 80 y 443
#   6. fail2ban (bloquea a quien prueba contraseñas por SSH)
#      y actualizaciones de seguridad automáticas
#
#  Se puede volver a ejecutar sin problema. Lo llama también instalar-servidor.sh.
#  NO toca la configuración de SSH (eso va en pasos guiados aparte).
# ==========================================================
set -euo pipefail

paso() { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
aviso(){ echo -e "  \033[33m⚠\033[0m $*"; }
fallo(){ echo -e "\n\033[1;31m✗ $*\033[0m"; exit 1; }

[ "$(id -u)" -eq 0 ] || fallo "Ejecútalo como root."
[ -f /etc/donde.env ] || fallo "No existe /etc/donde.env: primero ejecuta deploy/instalar-servidor.sh"
# shellcheck disable=SC1091
. /etc/donde.env
REPO_DIR="${REPO_DIR:-/var/www/testing}"
BRANCH="${BRANCH:-testing}"
DATA_DIR="$(dirname "${DB_PATH:-/var/lib/donde/donde.db}")"
IP="${PUBLIC_ORIGIN#https://}"
DEPLOY_HOME=/var/lib/donde-deploy
SYSTEMCTL="$(command -v systemctl)"
export DEBIAN_FRONTEND=noninteractive
[ -d "$REPO_DIR/.git" ] || fallo "No encuentro el repo en $REPO_DIR"

salud() { curl -fsS --max-time 3 http://127.0.0.1:${PORT:-3000}/api/health >/dev/null 2>&1; }
esperar_salud() { for _ in 1 2 3 4 5 6 7 8 9 10; do salud && return 0; sleep 1; done; return 1; }

# ----------------------------------------------------------
paso "1/6 Despliegue sin root"
apt-get install -y -qq sudo git >/dev/null
id deploy >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DEPLOY_HOME" --shell /usr/sbin/nologin deploy
mkdir -p "$DEPLOY_HOME" && chown deploy:deploy "$DEPLOY_HOME" && chmod 750 "$DEPLOY_HOME"

# El remoto, sin usuario ni token dentro de la URL
URL="$(git -C "$REPO_DIR" remote get-url origin)"
CLEAN_URL="$(echo "$URL" | sed -E 's#^https://[^/@]+@#https://#')"
[ "$URL" != "$CLEAN_URL" ] && git -C "$REPO_DIR" remote set-url origin "$CLEAN_URL" && ok "Quitado el token de la URL del repo"

chown -R deploy:deploy "$REPO_DIR"
chmod -R u+rwX,go+rX,go-w "$REPO_DIR"
# Que root pueda seguir usando git en esa carpeta si hace falta
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$REPO_DIR" \
  || git config --system --add safe.directory "$REPO_DIR"

# ¿Se puede descargar sin credenciales? (el repo es público)
if sudo -u deploy -H env GIT_TERMINAL_PROMPT=0 git -C "$REPO_DIR" ls-remote -q origin "$BRANCH" >/dev/null 2>&1; then
  ok "deploy descarga de GitHub sin contraseña ni token"
  if [ -f /root/.git-credentials ]; then
    rm -f /root/.git-credentials
    git config --global --unset-all credential.helper 2>/dev/null || true
    ok "Borrado /root/.git-credentials (revoca también ese token en GitHub)"
  fi
else
  aviso "deploy no puede descargar el repo sin credenciales (¿es privado?). Dejo /root/.git-credentials tal cual."
  aviso "El cron seguirá como root hasta que el repo sea público o deploy tenga una clave de solo lectura."
  NO_DEPLOY=1
fi

# Lo único que deploy puede hacer como root: reiniciar el juego
cat > /etc/sudoers.d/donde-deploy <<EOF
# deploy (el cron de actualización) solo puede reiniciar el servidor de partidas
deploy ALL=(root) NOPASSWD: $SYSTEMCTL restart donde
EOF
chmod 440 /etc/sudoers.d/donde-deploy
visudo -cf /etc/sudoers.d/donde-deploy >/dev/null || { rm -f /etc/sudoers.d/donde-deploy; fallo "sudoers no válido"; }

touch /var/log/donde-actualizar.log && chown deploy:deploy /var/log/donde-actualizar.log
rm -f /var/lock/donde-actualizar.lock /run/donde-actualizar.lock
CRON_USER=deploy; [ "${NO_DEPLOY:-0}" = 1 ] && CRON_USER=root
cat > /etc/cron.d/donde-actualizar <<EOF
# Cada minuto: trae lo último de la rama $BRANCH y reinicia el servidor si ha cambiado.
# Corre como "$CRON_USER" (no root): solo puede reiniciar el servicio.
* * * * * $CRON_USER $REPO_DIR/deploy/actualizar.sh >> /var/log/donde-actualizar.log 2>&1
EOF
chmod 644 /etc/cron.d/donde-actualizar
cat > /etc/logrotate.d/donde <<EOF
/var/log/donde-actualizar.log /var/lib/donde/copias/copia.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    su root root
}
EOF
ok "Cron de actualización como $CRON_USER"

# ----------------------------------------------------------
paso "2/6 Servicio encerrado"
sed "s#__REPO__#$REPO_DIR#g" "$REPO_DIR/deploy/donde.service" > /etc/systemd/system/donde.service
mkdir -p /etc/systemd/system/donde.service.d
cp "$REPO_DIR/deploy/donde-endurecido.conf" /etc/systemd/system/donde.service.d/endurecido.conf
systemctl daemon-reload
systemctl restart donde
if esperar_salud; then
  ok "donde en marcha sin red hacia fuera y sin permisos especiales"
else
  # Algunos VPS (contenedores) no admiten parte del encierro: se quita y se avisa
  rm -f /etc/systemd/system/donde.service.d/endurecido.conf
  systemctl daemon-reload
  systemctl restart donde
  esperar_salud || fallo "El servidor no arranca. Mira: journalctl -u donde -n 50"
  aviso "Este VPS no admite el encierro extra de systemd; se queda la protección básica."
fi

# ----------------------------------------------------------
paso "3/6 Base de datos y copias"
chown donde:donde "$DATA_DIR"
chmod 700 "$DATA_DIR"
find "$DATA_DIR" -maxdepth 1 -name 'donde.db*' -exec chmod 600 {} + 2>/dev/null || true
mkdir -p "$DATA_DIR/copias" && chown donde:donde "$DATA_DIR/copias" && chmod 700 "$DATA_DIR/copias"
NODE="$(command -v node)"
cat > /etc/cron.d/donde-copia <<EOF
# Copia de la base de datos cada día a las 4:37, con la prioridad más baja de CPU y disco.
# Guarda las 7 últimas en $DATA_DIR/copias
37 4 * * * donde nice -n 19 ionice -c3 env DB_PATH=$DATA_DIR/donde.db $NODE $REPO_DIR/server/backup.js >> $DATA_DIR/copias/copia.log 2>&1
EOF
chmod 644 /etc/cron.d/donde-copia
sudo -u donde env DB_PATH="$DATA_DIR/donde.db" nice -n 19 ionice -c3 "$NODE" "$REPO_DIR/server/backup.js" \
  && ok "Primera copia hecha" || aviso "La primera copia falló (se volverá a intentar esta noche)"

# ----------------------------------------------------------
paso "4/6 Apache"
# "zz-" para que se cargue después del security.conf de Ubuntu (que dice "ServerTokens OS")
a2disconf -q donde-seguridad >/dev/null 2>&1 || true
cat > /etc/apache2/conf-available/zz-donde-seguridad.conf <<'EOF'
# No decir la versión de Apache ni del sistema
ServerTokens Prod
ServerSignature Off
TraceEnable Off
EOF
a2enconf -q zz-donde-seguridad >/dev/null
a2enmod -q headers >/dev/null
if [ -f "/etc/letsencrypt/live/$IP/fullchain.pem" ]; then
  sed -e "s#__IP__#$IP#g" -e "s#__WWW__#$REPO_DIR/www#g" \
    "$REPO_DIR/deploy/apache-donde.conf" > /etc/apache2/sites-available/donde.conf
fi
apache2ctl configtest 2>/dev/null || fallo "La configuración de Apache no es válida: apache2ctl configtest"
systemctl reload apache2
ok "Apache sin versión a la vista y con X-Real-IP"

# ----------------------------------------------------------
paso "5/6 Cortafuegos"
apt-get install -y -qq ufw >/dev/null
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"; SSH_PORT="${SSH_PORT:-22}"
# Por si acaso, también el puerto por el que estás conectado ahora mismo (para no quedarte fuera)
CUR_PORT="$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')"
[ -n "$CUR_PORT" ] && [ "$CUR_PORT" != "$SSH_PORT" ] && ufw allow "$CUR_PORT/tcp" >/dev/null
if ufw allow "$SSH_PORT/tcp" >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null \
   && ufw default deny incoming >/dev/null && ufw default allow outgoing >/dev/null \
   && ufw --force enable >/dev/null; then
  ok "ufw activo: abiertos $SSH_PORT (SSH), 80 y 443"
else
  aviso "ufw no se pudo activar en este VPS (usa el cortafuegos del panel del proveedor)"
fi

# ----------------------------------------------------------
paso "6/6 fail2ban y actualizaciones de seguridad"
apt-get install -y -qq fail2ban python3-systemd unattended-upgrades >/dev/null
cat > /etc/fail2ban/jail.d/donde.local <<EOF
# 5 intentos fallidos de SSH en 10 minutos = 1 hora bloqueado
[sshd]
enabled  = true
backend  = systemd
port     = $SSH_PORT
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable -q fail2ban && systemctl restart fail2ban && ok "fail2ban vigilando SSH" \
  || aviso "fail2ban no arrancó: journalctl -u fail2ban -n 30"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
ok "Actualizaciones de seguridad automáticas (sin reinicios automáticos)"

# ----------------------------------------------------------
echo -e "\n\033[1;32m✔ Servidor endurecido.\033[0m"
salud && ok "El juego responde" || aviso "El juego no responde: journalctl -u donde -n 50"
cat <<EOF

  Actualizaciones:  tail -f /var/log/donde-actualizar.log   (ahora como "$CRON_USER")
  Copias:           ls -lh $DATA_DIR/copias
  Cortafuegos:      ufw status
  Bloqueados SSH:   fail2ban-client status sshd

  Queda a mano: entrar por SSH solo con clave (te lo explico aparte).
EOF
