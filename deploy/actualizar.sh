#!/usr/bin/env bash
# ==========================================================
#  Actualización automática (lo ejecuta el cron cada minuto)
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
  exec 9>/run/donde-actualizar.lock
  flock -n 9 || exit 0

  cd "$REPO"
  git fetch -q origin "$BRANCH"
  local before after
  before=$(git rev-parse HEAD)
  after=$(git rev-parse "origin/$BRANCH")
  [ "$before" = "$after" ] && exit 0

  echo "[$(date '+%F %T')] Actualizando ${before:0:7} → ${after:0:7}"
  git reset -q --hard "origin/$BRANCH"

  # ¿Ha cambiado algo del servidor?
  local changed
  changed=$(git diff --name-only "$before" "$after" -- server www/shot.js www/data.js www/elo.js || true)
  if [ -n "$changed" ]; then
    if git diff --name-only "$before" "$after" | grep -q '^server/package'; then
      echo "  Dependencias nuevas → npm ci"
      (cd server && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
    fi
    echo "  Reiniciando el servidor de partidas"
    systemctl restart donde
  fi
  echo "  Listo"
}
main "$@"
exit
