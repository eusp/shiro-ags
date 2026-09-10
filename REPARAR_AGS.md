# Guía de Reparación de AGS en Nobara/Fedora

Qué se rompió en el pasado, por qué ya no debería volver a pasar, y qué revisar si AGS no arranca.

---

## 1. Historial: por qué se rompía AGS

1. **Repositorio COPR dado de baja.** El COPR original (`fbeigbeder/astal`) desapareció (*404 Not Found*).
   Fedora marcó `aylurs-gtk-shell` y los `libastal-*` como huérfanos y los desinstaló en un
   `dnf upgrade`/`autoremove`, dejando el error:
   ```log
   JS ERROR: Error: Requiring Astal, version 4.0: Typelib file for namespace 'Astal', version '4.0' not found
   ```
2. **`astal-libs` desincronizado con Hyprland.** Después se usó `astal-libs` (un solo paquete con
   todos los módulos) desde `solopasha/hyprland`. Cada vez que Hyprland se actualizaba, el build de
   `astal-libs` quedaba viejo: errores en bucle y ~60% de CPU sostenido.

## 2. Cómo está resuelto ahora

- **Sin `astal-libs`:** los módulos AstalHyprland, AstalNetwork, AstalBattery, etc. se reemplazaron
  por integraciones propias en `lib/` (hyprctl, D-Bus, wpctl). Solo se depende del core:
  `astal-io` y `astal-gtk4`.
- **Astal core** viene del COPR `sdegler/hyprland` (`solopasha/hyprland` quedó deshabilitado).
- **AGS v3** está compilado desde el código fuente en `~/ags` e instalado en `/usr/local`,
  así que ningún `dnf` lo puede desinstalar.
- **Hyprland 0.55+ con config en Lua:** los `hyprctl dispatch` clásicos y `hyprctl keyword` no
  funcionan; el código usa `hyprctl dispatch "hl.dsp.…"` y `hyprctl switchxkblayout`.

La instalación completa desde cero está en `SETUP.md`.

> En **Arch/CachyOS** el COPR no aplica: `astal-io`/`astal4` vienen de AUR (`libastal-io-git`,
> `libastal-4-git`). Donde la tabla de abajo dice `dnf install ...`, usa `paru -S libastal-io-git libastal-4-git`.

---

## 3. Si AGS no arranca

Ejecútalo a mano para ver el error:
```bash
ags quit; ags run ~/.config/ags/app.ts
```

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Typelib file for namespace 'Astal', version '4.0' not found` | Se desinstaló `astal-gtk4`/`astal-io` | `sudo dnf install astal-io astal-gtk4` (COPR `sdegler/hyprland`) |
| `ags: command not found` | Se borró `/usr/local/bin/ags` | `cd ~/ags && git pull && sudo meson install -C build` |
| Error de símbolo/librería al iniciar AGS tras actualizar el sistema | AGS compilado contra versiones viejas de Astal/gjs | `cd ~/ags && meson setup --wipe build && sudo meson install -C build` |
| Botones de Hyprland (salir, layout de teclado) no hacen nada | Sintaxis clásica de `hyprctl` con config en Lua | Usar `hl.dsp.*` / `switchxkblayout` (ver commits `6ef0b09`, `51328c5`) |
| Los estilos no cargan | Falta `sass` en el `PATH` | Instalar dart-sass |

Verificación rápida del core de Astal:
```bash
gjs -c "imports.gi.versions.Astal = '4.0'; imports.gi.Astal; imports.gi.AstalIO; log('Astal OK')"
```
