import { Gtk } from "ags/gtk4"
import Hyprland, { Client } from "../../lib/hyprland"
import Gio from "gi://Gio"
import GioUnix from "gi://GioUnix"
import { AppContextMenu, attachAppMenu, toggleAppWindows } from "../Shared/AppContextMenu"
import pins from "../../lib/pins"
import { findAppMatch, resolveAppIcon } from "../../lib/icons"

const hyprland = Hyprland.get_default()

const DEFAULT_APPS = [
    { icon: "org.gnome.Ptyxis", command: "ptyxis", tooltip: "Terminal", matches: "ptyxis", id: "org.gnome.Ptyxis.desktop" },
    { icon: "org.gnome.Nautilus", command: "nautilus", tooltip: "Nautilus", matches: "nautilus", id: "org.gnome.Nautilus.desktop" },
    { icon: "firefox", command: "firefox", tooltip: "Firefox", matches: "firefox", id: "firefox.desktop" },
]

function launchDetached(command: string) {
    const { Gio } = imports.gi;
    try {
        new Gio.Subprocess({ argv: [command] }).init(null);
    } catch (e) {
        // @ts-ignore
        if (typeof print !== 'undefined') print(e);
    }
}

function createContextMenu(widget: Gtk.Widget, client?: Client, appInfo?: any) {
    const match = appInfo?.matches || client?.class?.toLowerCase() || ""
    const { desktopApp, astalId } = findAppMatch(match)
    const clients = match ? hyprland.clients.filter(c => (c.class?.toLowerCase() || "").includes(match)) : []
    if (client && !clients.includes(client)) clients.unshift(client)

    return AppContextMenu(widget, {
        name: desktopApp?.get_display_name() || appInfo?.tooltip || client?.class || "",
        icon: desktopApp?.get_icon() || appInfo?.icon || resolveAppIcon(client?.class || ""),
        appId: desktopApp?.get_id() || astalId || appInfo?.id || "",
        desktopApp,
        onNewWindow: appInfo ? () => launchDetached(appInfo.command) : undefined,
        clients,
    }, Gtk.PositionType.RIGHT)
}

// Ícono con un puntito por ventana abierta debajo (hasta 3), si hay 2 o más
function withDots(icon: Gtk.Widget, count: number): Gtk.Widget {
    if (count < 2) return icon
    const overlay = new Gtk.Overlay({ child: icon })
    const dots = new Gtk.Box({ spacing: 2, halign: Gtk.Align.CENTER, valign: Gtk.Align.END, cssClasses: ["window-dots"], canTarget: false })
    for (let i = 0; i < Math.min(count, 3); i++) dots.append(new Gtk.Box({ cssClasses: ["window-dot"], valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER }))
    overlay.add_overlay(dots)
    return overlay
}

export default function AppList() {
    // Se estira por todo el hueco libre de la barra (las apps quedan arriba);
    // el visualizador solo ocupa lo que dibuja.
    const container = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.START,
        vexpand: true,
        spacing: 8
    })

    const update = () => {
        const { GLib } = imports.gi;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            while (container.get_first_child()) {
                container.remove(container.get_first_child()!)
            }

            const clients = hyprland.clients
            const focused = hyprland.focusedClient
            const currentSidebarPins = pins.getSidebar()
            const allPinned = [...DEFAULT_APPS]

            currentSidebarPins.forEach(id => {
                if (!allPinned.some(a => a.id === id)) {
                    // @ts-ignore
                    const DesktopAppInfo = (imports.gi.GioUnix ? imports.gi.GioUnix.DesktopAppInfo : Gio.DesktopAppInfo)
                    const di = DesktopAppInfo.new(id)
                    if (di) {
                        allPinned.push({
                            icon: di.get_icon()?.to_string() || "system-run-symbolic",
                            command: di.get_executable() || "",
                            tooltip: di.get_display_name() || id,
                            matches: id.split(".")[0].toLowerCase(),
                            id: id
                        })
                    }
                }
            })

            allPinned.forEach(app => {
                const runningClient = clients.find(c => (c.class?.toLowerCase() || "").includes(app.matches))
                const isFocused = focused && (focused.class?.toLowerCase() || "").includes(app.matches)
                const isRunning = !!runningClient

                const btn = new Gtk.Button({ tooltipText: app.tooltip })
                btn.add_css_class("shortcut-btn")
                if (isFocused) btn.add_css_class("active")
                else if (isRunning) btn.add_css_class("running")

                const icon = app.icon.includes("/")
                    ? new Gtk.Image({ file: app.icon, pixelSize: 24 })
                    : new Gtk.Image({ iconName: app.icon })
                const windowCount = clients.filter(c => (c.class?.toLowerCase() || "").includes(app.matches)).length
                btn.set_child(withDots(icon, windowCount))
                if (windowCount > 1) btn.add_css_class("multi")

                // Con varias ventanas elige la correcta (ver toggleAppWindows)
                btn.connect("clicked", () => {
                    const wins = hyprland.clients.filter(c => (c.class?.toLowerCase() || "").includes(app.matches))
                    if (wins.length === 0) launchDetached(app.command)
                    else toggleAppWindows(wins)
                })

                attachAppMenu(btn, () => createContextMenu(btn, runningClient, app))
                container.append(btn)
            })

            clients.forEach(client => {
                const isDefault = allPinned.some(a => (client.class?.toLowerCase() || "").includes(a.matches))
                if (isDefault) return

                const isMinimized = client.workspace && (client.workspace.name || "").includes("minimized")
                const inCurrentWS = focused && focused.workspace && client.workspace.id === focused.workspace.id

                if (!isMinimized && !inCurrentWS) return

                const isActive = focused && focused.address === client.address

                const btn = new Gtk.Button({ tooltipText: client.title })
                btn.add_css_class("shortcut-btn")
                if (isActive) btn.add_css_class("active")

                btn.set_child(new Gtk.Image({ iconName: resolveAppIcon(client.class || "") }))

                btn.connect("clicked", () => toggleAppWindows([client]))

                attachAppMenu(btn, () => createContextMenu(btn, client))
                container.append(btn)
            })

            return GLib.SOURCE_REMOVE;
        })
    }

    hyprland.connect("notify::clients", update)
    hyprland.connect("notify::focused-client", update)
    pins.connect("sidebar-changed", update)
    update()

    return container
}