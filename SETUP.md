# Guía de Instalación

Esta guía instala todo lo necesario para que esta configuración de AGS funcione.

- **Arch / CachyOS**: la forma recomendada es `install.sh` de [shiro-theme](https://github.com/eusp/shiro-theme),
  que hace todos estos pasos. Abajo está el detalle por si hay que hacerlo a mano.
- **Nobara / Fedora**: ver la sección [Nobara/Fedora](#nobarafedora).

## Arch / CachyOS

### 1. Paquetes de los repos
```bash
sudo pacman -S --needed git base-devel nodejs npm curl \
    hyprland gjs gtk4 gtk4-layer-shell dart-sass libnotify wl-clipboard cliphist \
    pipewire-pulse wireplumber libpulse pavucontrol networkmanager nm-connection-editor \
    upower bluez bluez-utils brightnessctl \
    meson ninja go gobject-introspection \
    ttf-jetbrains-mono-nerd adwaita-icon-theme avahi nss-mdns
```

`powerprofilesctl`: CachyOS puede traer `tuned-ppd`, que ya lo incluye. Si no existe el comando,
instala `power-profiles-daemon` (no los dos, chocan).

### 2. Astal core (AUR)
Solo se usan `astal-io` y `astal4` (ver la sección de Astal más abajo):

```bash
sudo pacman -S --needed paru      # CachyOS ya no trae helper de AUR preinstalado
paru -S libastal-io-git libastal-4-git
```

### 3. AGS v3 desde el código fuente
Existe `aylurs-gtk-shell-git` en AUR, pero se instala en `/usr`, y `package.json` apunta a
`/usr/local/share/ags/js` (tipos para `npm run check`). Compilarlo deja todo igual que en Fedora:

```bash
git clone https://github.com/aylur/ags.git ~/ags
cd ~/ags
npm install
meson setup build
sudo meson install -C build
ags --version
```

### 4. Clonar la configuración
```bash
git clone https://github.com/eusp/shiro-ags.git ~/.config/shiro-ags
ln -s ~/.config/shiro-ags ~/.config/ags
cd ~/.config/shiro-ags && npm install
```

### 5. Detalles de Arch
- **`*.local` (audio-route.sh)**: Arch no resuelve mDNS por defecto. `sudo systemctl enable --now avahi-daemon`
  y en `/etc/nsswitch.conf` agrega `mdns_minimal [NOTFOUND=return]` antes de `resolve` en la línea `hosts:`.
- **Hostnames**: `scripts/audio-route.sh` busca `CachyOS-PC` / `CachyOS-Laptop`. Si cambias el nombre de los
  equipos, edita `PC_HOST`/`LT_HOST` (y las direcciones `.local`) al principio del script.
- **Brillo**: `sudo usermod -aG video $USER` en el laptop.

---

## Nobara/Fedora

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
git clone https://github.com/eusp/shiro-ags.git ~/.config/shiro-ags
ln -s ~/.config/shiro-ags ~/.config/ags
cd ~/.config/shiro-ags
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
Los íconos de aplicación (sidebar, preview de apps por workspace en la topbar) se resuelven a partir
del `Icon=` real del `.desktop` de cada app (`lib/icons.ts`), no adivinando nombres — así que el tema
de iconos que uses necesita variedad de íconos de apps a color, no solo los simbólicos de Adwaita.

- **Paquete de Iconos recomendado**: [Papirus](https://github.com/PapirusDevelopmentTeam/papirus-icon-theme)
  (`papirus-icon-theme` en Arch/CachyOS, repo `extra`) — flat, gran cobertura de apps, ~110 MB instalado.
  Activalo con `gsettings set org.gnome.desktop.interface icon-theme 'Papirus-Dark'` (o `'Papirus'` para
  el tema claro) y, si usás apps GTK3 sin un daemon de xsettings corriendo, replicá el mismo nombre en
  `~/.config/gtk-3.0/settings.ini` y `~/.config/gtk-4.0/settings.ini` (`gtk-icon-theme-name=Papirus-Dark`).
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
- **Enviar audio a otro equipo (SideBar)**: `scripts/audio-route.sh` usa `ssh` sin contraseña (llaves) y `pactl` entre `CachyOS-PC` y `CachyOS-Laptop`, así que cada equipo necesita sshd activo y la llave del otro en `~/.ssh/authorized_keys`. Si un equipo ya le está enviando audio al otro, el envío en sentido contrario se bloquea con una notificación (los dos túneles harían que el audio diera vueltas entre ambos).
- **Idioma de teclado (TopBar)**: `hyprctl devices -j` puede listar varios "teclados" (mouse con teclas propias, cada sub-interfaz HID de un teclado mecánico, botones de power, etc.) — `KeyboardLayout.tsx` usa el que Hyprland marca con `"main": true`, no el primero de la lista, para no terminar cambiándole el idioma a un dispositivo que nadie usa para escribir.
