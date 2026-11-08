# ¿Dónde queda...? — notas para trabajar en el repo

- Rama de trabajo: `testing`. El VPS la descarga sola cada minuto (`deploy/actualizar.sh`).
- Los cambios se entregan como parche (`git format-patch`) con autor Raoul Labrunie
  <rlabrunieespinosa@gmail.com> y Claude como coautor.
- Pruebas: `cd server && npm test`.
- Titulares del juego (y corresponsables de los datos): Raoul Labrunie y Ventura Macarro Díaz,
  como Olseis Games. Contacto público: contacto@donde.com.

## Parte legal (mantener al día en CADA parche)

Los textos legales están en `www/legal.html` (aviso legal, privacidad, condiciones,
borrar mis datos y licencias). Antes de cerrar un parche, comprueba si toca alguno de
estos puntos y, si es así, actualiza `www/legal.html`:

| Si el parche... | Hay que actualizar |
|---|---|
| guarda, envía o deja de guardar algún dato del jugador (nuevo campo en la BD, nuevo mensaje con datos, logs) | Tabla «Qué datos, para qué…» y «Cómo borrar tus datos». Revisar también `/api/online/me` y `/api/online/delete` |
| cambia cuánto tiempo se guarda algo (partidas, copias, registros, inactividad) | Columna «Cuánto tiempo» |
| carga algo de otro servidor (CDN, mapas, fuentes, analítica, anuncios) | «Con quién se comparten» y «Licencias». Mejor meterlo en `www/vendor/` |
| añade una librería, fuente o datos de terceros | «Licencias y créditos» y su LICENSE en `www/vendor/` |
| añade anuncios o compras | Aviso legal (datos fiscales), privacidad (consentimiento de anuncios), condiciones y la ficha de las tiendas |
| cambia la edad mínima o las normas del juego | «Edad mínima» y «Condiciones de uso» |

Si el cambio es importante para el jugador, sube la fecha en los dos sitios:
`LEGAL_VERSION` en `www/online.js` y la versión al principio de `www/legal.html`.
Así el juego vuelve a pedir la aceptación antes de jugar online.
Actualiza también el apartado «Parte legal» de la documentación del proyecto.
