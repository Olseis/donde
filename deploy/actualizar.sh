#!/usr/bin/env bash
# ==========================================================
#  Actualización automática (lo ejecuta el cron cada minuto)
#
#  Corre como el usuario "deploy", que es dueño del repo pero NO es root:
#  lo único que puede hacer como root es reiniciar el servicio "donde"
#  (una sola línea en /etc/sudoers.d/donde-deploy). Así, aunque alguien
#  subiera código malicioso a GitHub, no tendría el control del VPS.
#
#  Sustituye a la antigua línea del cron
#    cd /var/www/testing && git fetch && git reset --hard origin/testing
#  y además, si ha cambiado el servidor, instala dependencias y lo reinicia.
#  Si no hay nada nuevo en GitHub, no toca nada.
# ==========================================================

# Todo va dentro de main(): así bash lee el script entero antes de ejecutarlo
# y no se lía si el propio git reset cambia este archivo a mitad.
main() {
  set -euo pipefail
  local CONF=/etc/donde.env
  # shellcheck disable=SC1090
  [ -f "$CONF" ] && . "$CONF"
  local REPO="${REPO_DIR:-/var/www/testing}"
  local BRANCH="${BRANCH:-testing}"

  # Si una actualización anterior sigue en marcha, no empezar otra
  exec 9>/var/lock/donde-actualizar.lock
  flock -n 9 || exit 0

  cd "$REPO"
  # Si la última vez se actualizó el código pero no se pudo reiniciar, se reintenta
  local PENDING="${HOME:-/tmp}/.donde-reinicio-pendiente"

  git fetch -q origin "$BRANCH"
  local before after
  before=$(git rev-parse HEAD)
  after=$(git rev-parse "origin/$BRANCH")
  if [ "$before" = "$after" ]; then
    [ -f "$PENDING" ] || exit 0
    echo "[$(date '+%F %T')] Reintentando lo que quedó a medias"
    reiniciar "$(cat "$PENDING")" "$PENDING"
    exit 0
  fi

  echo "[$(date '+%F %T')] Actualizando ${before:0:7} → ${after:0:7}"
  git reset -q --hard "origin/$BRANCH"

  # ¿Ha cambiado algo del servidor?
  local changed deps=no
  changed=$(git diff --name-only "$before" "$after" -- server www/shot.js www/data.js www/elo.js || true)
  if [ -n "$changed" ]; then
    git diff --name-only "$before" "$after" | grep -q '^server/package-lock.json' && deps=yes
    # Se apunta antes de intentarlo: si falla, el próximo minuto se vuelve a probar
    [ "$(cat "$PENDING" 2>/dev/null)" = yes ] && deps=yes
    echo "$deps" > "$PENDING"
    reiniciar "$deps" "$PENDING"
  fi
  echo "  Listo"
}

# reiniciar <yes|no: npm ci> <archivo de pendiente>
reiniciar() {
  if [ "$1" = yes ]; then
    echo "  Dependencias nuevas → npm ci"
    (cd server && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  fi
  echo "  Reiniciando el servidor de partidas"
  # Ruta completa: es la única orden que /etc/sudoers.d/donde-deploy le deja usar a deploy
  local SYSTEMCTL
  SYSTEMCTL="$(command -v systemctl)"
  if [ "$(id -u)" -eq 0 ]; then "$SYSTEMCTL" restart donde; else sudo -n "$SYSTEMCTL" restart donde; fi
  rm -f "$2"
}
main "$@"
exit
