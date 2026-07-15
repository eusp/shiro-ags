# Guía de Instalación (Nobara/Fedora)

Esta guía te ayudará a instalar todas las dependencias necesarias para que tu configuración de AGS funcione en tu laptop Nobara.

## 1. Instalar Hyprland y Herramientas base
```bash
sudo dnf install hyprland wl-clipboard cliphist pulseaudio-utils nm-connection-editor upower bluez gjs brightnessctl
```

## 2. Instalar AGS (Astal)
AGS v2 (Astal) puede requerir un repositorio Copr en Fedora:
```bash
sudo dnf copr enable fbeigbeder/astal
sudo dnf install aylurs-gtk-shell
# Instalar bibliotecas de Astal específicas
sudo dnf install libastal-hyprland libastal-wp libastal-network libastal-battery libastal-bluetooth libastal-mpris libastal-tray
```

## 3. Instalar Dependencias de Desarrollo
```bash
sudo dnf install nodejs npm sass
```

## 4. Clonar e Inicializar el Proyecto
Suponiendo que ya lo tienes en GitHub:
```bash
git clone https://github.com/eusp/ags.git ~/.config/ags
cd ~/.config/ags
npm install
```

## 5. Ejecutar
Para probar la configuración:
```bash
npm run dev
```

## 6. Iconos y Fuentes
Esta configuración utiliza **Iconos Simbólicos de GTK** estándar. Para que se visualicen correctamente, es **indispensable** tener instalada una Nerd Font.

- **Paquete de Iconos**: Adwaita (o cualquier tema de iconos estándar de GNOME/GTK que incluya iconos simbólicos).
- **Fuente Recomendada**: `JetBrainsMono Nerd Font`.

Para instalar la fuente en Nobara/Fedora:
```bash
sudo dnf install jetbrains-mono-fonts-all # Luego instala manualmente la versión Nerd Font o usa un gestor de fuentes.
```

---

### Notas Adicionales
- **Visualizador de Audio**: Asegúrate de que `pipewire-pulse` esté instalado (generalmente lo está en Nobara) para que `parec` funcione correctamente.
- **Fuentes**: La interfaz depende de `JetBrainsMono Nerd Font`. Si ves rectángulos en lugar de iconos, verifica que la fuente esté bien instalada y reconocida por el sistema.
- **Brillo (RightMenu)**: El slider de brillo usa `brightnessctl` sobre el panel de retroiluminación real (`/sys/class/backlight`), pensado para pantallas de laptop. Requisitos:
    - Debe existir un dispositivo en `/sys/class/backlight/` (`brightnessctl -c backlight -l` lo lista). Los monitores externos por VGA/HDMI genérico normalmente **no** exponen esto — en ese caso el widget se oculta automáticamente (no rompe el panel).
    - Puede requerir pertenecer al grupo `video` para escribir en el backlight sin sudo: `sudo usermod -aG video $USER` (cierra sesión y vuelve a entrar).

