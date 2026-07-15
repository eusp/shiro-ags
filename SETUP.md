# Guía de Instalación (Nobara/Fedora)

Esta guía te ayudará a instalar todas las dependencias necesarias para que tu configuración de AGS funcione en tu laptop Nobara.

## 1. Instalar Hyprland y Herramientas base
```bash
sudo dnf install hyprland wl-clipboard cliphist pulseaudio-utils nm-connection-editor upower bluez gjs ddcutil
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
- **Brillo (RightMenu)**: El slider de brillo usa `ddcutil` (DDC/CI) para controlar el brillo del monitor externo por hardware. Requisitos:
    - El monitor debe soportar DDC/CI y tenerlo **habilitado en su menú OSD** (busca una opción "DDC/CI" en Settings/Other Settings del propio monitor).
    - Tu usuario necesita permisos de lectura/escritura sobre `/dev/i2c-*` (en Nobara suelen venir ya con ACL de usuario; si no, añade una regla udev o el usuario al grupo `i2c`).
    - Si `ddcutil detect` no encuentra un display válido, el widget de brillo se oculta automáticamente (no rompe el panel).

