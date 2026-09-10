# Guía de Instalación (Nobara/Fedora)

Esta guía instala todo lo necesario para que esta configuración de AGS funcione en Nobara/Fedora.

## 1. Hyprland y herramientas del sistema
```bash
sudo dnf install hyprland gjs gtk4-layer-shell wl-clipboard cliphist \
    pipewire-pulseaudio pulseaudio-utils wireplumber NetworkManager nm-connection-editor \
    upower bluez power-profiles-daemon brightnessctl libnotify pavucontrol curl nodejs nodejs-npm
```

Qué usa cada una:
- `hyprctl` (Hyprland): workspaces, ventana activa, layout de teclado, salir de la sesión.
- `wpctl` / `pactl` / `parec` / `paplay`: volumen, micrófono, visualizador de audio y sonido de notificaciones.
- `nmcli`: escaneo de redes Wi-Fi (el estado se lee de NetworkManager por D-Bus).
- UPower, bluez y MPRIS se leen por D-Bus — solo tienen que estar corriendo.
- `powerprofilesctl`: botón de perfil de energía de la barra lateral.
- `brightnessctl`: slider de brillo (ver notas abajo).
- `cliphist` + `wl-copy`: historial del portapapeles.
- `curl`: clima (`wttr.in`) en el RightMenu.
- `node`: el selector de temas ejecuta los builders de `~/.config/shiro-theme`.

## 2. Astal (core)
De Astal el código solo usa `Astal.Window` (ventanas layer-shell), que viene en `astal-gtk4`.
Los módulos de `astal-libs` (AstalHyprland, AstalNetwork, etc.) **no se usan** — `lib/` los
reemplaza (ver README). Aun así el paquete `astal-gtk4` de este COPR arrastra `astal-io` y
`astal-libs` como dependencias; es normal que se instalen.

```bash
sudo dnf copr enable sdegler/hyprland
sudo dnf install astal-io astal-gtk4
```

## 3. AGS v3 (compilado desde el código fuente)
AGS no tiene paquete; se compila desde https://github.com/aylur/ags e instala en `/usr/local`.

```bash
sudo dnf install golang meson ninja-build
git clone https://github.com/aylur/ags.git ~/ags
cd ~/ags
meson setup build
sudo meson install -C build
ags --version
```

AGS compila los estilos SCSS con `sass` (dart-sass), que tiene que estar en el `PATH`
(en esta máquina está en `/usr/local/bin/sass`).

## 4. Clonar la configuración
```bash
git clone https://github.com/eusp/ags.git ~/.config/ags
cd ~/.config/ags
npm install
```

`notes.json`, `pinned.json` y `bt-devices.json` no están en git: el shell los crea solo
la primera vez que los necesita.

## 5. Ejecutar
```bash
ags run ~/.config/ags/app.ts
```

Hyprland lo lanza al iniciar sesión desde `~/.config/hypr/hyprland.lua`.

AGS ejecuta los `.ts`/`.tsx` directamente (los empaqueta en memoria con esbuild), así que
**no hay paso de compilación**. `npm run check` solo verifica tipos y nunca genera `.js`.

Tipos para el editor y `npm run check`:
- GJS/GTK4/GioUnix/Adw vienen de los paquetes `@girs/*` de npm (versión `4.0.0-rc.17`, la que usa gnim).
- Astal no tiene paquete de tipos (solo instala el typelib), así que `types/gi-extra.d.ts` declara
  a mano lo que se usa (`Astal.Window`, sus enums y `Astal.Slider`).
- `npm run check` ignora 2 errores que están dentro del propio código de AGS/gnim
  (`/usr/local/share/ags/js`), no en esta configuración.

## 6. Iconos y Fuentes
Esta configuración utiliza **Iconos Simbólicos de GTK** estándar y una Nerd Font.

- **Paquete de Iconos**: Adwaita (o cualquier tema de iconos GTK que incluya iconos simbólicos).
- **Fuente Recomendada**: `JetBrainsMono Nerd Font`.

```bash
sudo dnf install jetbrains-mono-fonts-all # Luego instala manualmente la versión Nerd Font o usa un gestor de fuentes.
```

---

### Notas Adicionales
- **Visualizador de Audio**: requiere `pipewire-pulse` (viene por defecto en Nobara) para que `parec` funcione.
- **Fuentes**: si ves rectángulos en lugar de iconos, verifica que la Nerd Font esté instalada y reconocida por el sistema.
- **Brillo (RightMenu)**: el slider usa `brightnessctl` sobre el panel de retroiluminación real (`/sys/class/backlight`), pensado para pantallas de laptop.
    - Debe existir un dispositivo en `/sys/class/backlight/` (`brightnessctl -c backlight -l` lo lista). Los monitores externos por VGA/HDMI normalmente **no** lo exponen — en ese caso el widget se oculta solo.
    - Puede requerir pertenecer al grupo `video`: `sudo usermod -aG video $USER` (cierra sesión y vuelve a entrar).
- **Enviar audio a otro equipo (SideBar)**: `scripts/audio-route.sh` usa `ssh` sin contraseña (llaves) y `pactl` entre `nobara-pc` y `nobara-laptop`.
