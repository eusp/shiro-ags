# AGS Configuration - Antigravity Edition

Una configuración de AGS (Aylur's GTK Shell) v2 altamente personalizada, minimalista y funcional, diseñada para Hyprland en Nobara Linux.

## ✨ Características Principales

- **Barra Superior (TopBar)**:
    - Indicadores de red, volumen, micrófono, batería y bluetooth.
    - **Alerta de batería baja/crítica**: notificación automática (con repetición cada 5 min) si te quedás sin cargador, basada en el `WarningLevel` que ya calcula UPower.
    - Historial de portapapeles integrado (`cliphist`).
    - Monitor de recursos (CPU/RAM) en tiempo real.
    - **Panel flotante de Fecha/Hora**: Al hacer clic en el reloj central se despliega un popover premium con:
        - Calendario interactivo (izquierda) — se restablece automáticamente al día actual cada vez que se abre.
        - Reloj digital completo `HH:MM:SS` con fecha extendida (derecha superior).
        - Centro de notificaciones reactivo con botón "Limpiar todo" e iconos de descarte individual (derecha inferior).
    - Sistema de popovers modulares con diseño premium unificado (MenuPopover).
- **Barra Lateral (SideBar)**:
    - Lanzador de aplicaciones dinámico que rastrea el workspace actual.
    - **Fijado (Pinning) Persistente:** Opciones de menú contextual para anclar y desanclar aplicaciones favoritas.
    - Visualizador de audio reactivo con escala logarítmica (20Hz-20kHz).
    - Controles de medios integrados.
- **Menú Derecho (RightMenu)**:
    - Configuración rápida (Mute, Bluetooth, WiFi).
    - Centro de notificaciones.
    - Buscador de aplicaciones y **panel de aplicaciones ancladas** con funcionamiento reactivo.
    - **Selector de temas integrado** con previsualización del wallpaper: cada tarjeta de tema tiene dos íconos (animado `.mp4` / estático `.png`) que aplican ese tema completo (colores AGS, bordes Hyprland y fondo de pantalla) en caliente, sin reiniciar nada.
    - Menú de apagado.

## 🎨 Sistema de Diseño

- **Paleta de Colores**: Definida por [shiro-theme](https://github.com/emerson/.config/shiro-theme) — variables CSS nativas en `styles/colors.scss`.  
  Los estilos usan `var(--primary)`, `var(--base)`, etc. en lugar de variables Sass, lo que permite **hot-reload de colores en runtime** sin recompilar ni reiniciar AGS.
- **Hot-reload de tema**: Al seleccionar un tema en el widget, se inyecta un `Gtk.CssProvider` con prioridad 900 (mayor que la prioridad de carga de AGS) que sobreescribe todas las variables de color al instante.
- **Popovers Unificados**: Todos los menús flotantes comparten el mismo estilo:
    - Borde sutil en los lados y abajo (sin borde superior).
    - Bordes redondeados solo en la parte inferior.
    - Sombra inferior y fondo semitransparente oscuro.

## 🛠️ Tecnologías

- **AGS (Astal/GTK4)**: Framework principal — solo el core (`astal-io`, `astal-gtk4`).
- **TypeScript**: Para una lógica robusta y tipada.
- **SCSS**: Estilos modulares y variables.
- **cliphist**: Para la gestión del portapapeles.
- **nm-connection-editor**: Para la configuración de red.

### Sin dependencias de astal-libs

Los módulos de integración con el sistema (`AstalHyprland`, `AstalNotifd`, `AstalBattery`, `AstalTray`, `AstalNetwork`, `AstalBluetooth`, `AstalMpris`, `AstalWp`, `AstalApps`) **no se usan** — solo estaban disponibles en un build viejo de `astal-libs` que se desincronizaba cada vez que se actualizaba Hyprland o el resto de astal. En su lugar, `lib/` implementa cada integración hablando directo con el sistema:

- `lib/hyprland.ts` — `hyprctl` + el socket de eventos de Hyprland (`.socket2.sock`).
- `lib/notifd.ts` — implementa el servicio D-Bus `org.freedesktop.Notifications` (AGS es su propio demonio de notificaciones).
- `lib/battery.ts` — UPower por D-Bus.
- `lib/tray.ts` — implementa `org.kde.StatusNotifierWatcher`/`StatusNotifierItem`/`DBusMenu` (AGS también hace de host del tray para todo el sistema).
- `lib/network.ts` — NetworkManager por D-Bus.
- `lib/bluetooth.ts` — bluez por D-Bus.
- `lib/mpris.ts` — MPRIS2 por D-Bus.
- `lib/wp.ts` — `wpctl`/`pactl subscribe` (WirePlumber no tiene una API D-Bus simple).
- `lib/apps.ts` — `Gio.AppInfo` directo.

Esto significa que AGS ya no depende de que `astal-libs` tenga la misma versión que Hyprland/el resto del sistema — el problema que rompía todo (errores en bucle, ~60% de CPU sostenido) al actualizar Hyprland no debería volver a pasar.

## 🚀 Instalación y Uso

1.  Asegúrate de tener `ags` (v2) instalado.
2.  Clona el repositorio en `~/.config/ags`.
3.  Ejecuta con:
    ```bash
    ags run app.ts
    ```

## 📂 Estructura del Proyecto

- `lib/`: Servicios de estado persistente (`pins.ts`, `notesStore.ts`) y las integraciones de sistema propias descritas arriba (`hyprland.ts`, `notifd.ts`, `battery.ts`, `tray.ts`, `network.ts`, `bluetooth.ts`, `mpris.ts`, `wp.ts`, `apps.ts`).
- `widget/`: Todos los componentes de la interfaz.
    - `Shared/`: Componentes reutilizables (ej. `MenuPopover.tsx`).
    - `TopBar/`: Widgets de la barra superior.
        - `Clock.tsx`: Reloj + popover de calendario, reloj digital y notificaciones.
    - `SideBar/`, `RightMenu/`: Widgets específicos de cada sección.
- `styles/`: Archivos SCSS organizados por componentes.
    - `colors.scss`: Variables CSS del tema activo (auto-generado por shiro-theme, no editar).
    - `popovers.scss`: Sistema global de estilos para todos los popovers/menús.
    - `topbar.scss`: Estilos de la barra superior y popover de fecha/hora.
- `app.ts`: Definición de las ventanas, configuración principal e inyección inicial de variables CSS del tema.
- `widget/RightMenu/ThemeSelector.tsx`: Selector de temas con hot-reload — carga temas desde `~/.config/shiro-theme/themes/`, previsualiza el wallpaper y aplica colores + fondo en caliente.
