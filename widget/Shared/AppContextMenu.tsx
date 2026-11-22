import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import GioUnix from "gi://GioUnix"
import Hyprland, { Client } from "../../lib/hyprland"
import { MenuPopover, MenuItem, MenuSection } from "./MenuPopover"
import pins from "../../lib/pins"

// Menú contextual de una app, común a la sidebar y al panel de apps:
//   encabezado (ícono, nombre, estado) · acciones del .desktop ·
//   nueva ventana y anclajes · fila de botones de ventana si está abierta.

const hyprland = Hyprland.get_default()

export interface AppMenuOptions {
    name: string
    icon: Gio.Icon | string | null
    appId: string
    desktopApp?: GioUnix.DesktopAppInfo | null  // de aquí salen las acciones
    onNewWindow?: () => void
    clients: Client[]  // ventanas abiertas de la app
}

const addrOf = (c: Client) => c.address.startsWith("0x") ? c.address : `0x${c.address}`

function header(opts: AppMenuOptions) {
    const image = new Gtk.Image({ pixelSize: 28, cssClasses: ["app-menu-icon"] })
    if (opts.icon instanceof Gio.Icon) image.set_from_gicon(opts.icon)
    else image.set_from_icon_name(opts.icon || "application-x-executable")

    const n = opts.clients.length
    const status = n === 0 ? "Sin abrir" : n === 1 ? "Abierta" : `${n} ventanas`

    const name = new Gtk.Label({ label: opts.name, xalign: 0, cssClasses: ["app-menu-name"], ellipsize: 3, maxWidthChars: 22 })
    const sub = new Gtk.Label({ label: status, xalign: 0, cssClasses: ["app-menu-status", ...(n > 0 ? ["running"] : [])] })
    const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER })
    text.append(name)
    text.append(sub)

    const box = new Gtk.Box({ spacing: 10, cssClasses: ["app-menu-header"] })
    box.append(image)
    box.append(text)
    return box
}

function windowButton(icon: string, label: string, dangerous = false) {
    const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3 })
    inner.append(new Gtk.Image({ iconName: icon }))
    inner.append(new Gtk.Label({ label }))
    return new Gtk.Button({ cssClasses: ["app-menu-win-btn", ...(dangerous ? ["dangerous"] : [])], child: inner, hexpand: true })
}

export function AppContextMenu(widget: Gtk.Widget, opts: AppMenuOptions, position: Gtk.PositionType) {
    const sections: MenuSection[] = [{ customChild: header(opts) }]

    // Acciones propias de la app (Steam: Store, Library…), sin íconos repetidos
    const actions: string[] = (opts.desktopApp as any)?.list_actions?.() ?? []
    const actionItems: MenuItem[] = actions.map(id => ({
        label: (opts.desktopApp as any).get_action_name(id) || id,
        onClick: () => (opts.desktopApp as any).launch_action(id, null),
    }))
    if (actionItems.length > 0) sections.push({ items: actionItems })

    // Nueva ventana (si la app no trae la suya) y anclajes
    const ownNewWindow = actionItems.some(i => {
        const l = (i.label ?? "").toLowerCase()
        return (l.includes("nueva") && l.includes("ventana")) || (l.includes("new") && l.includes("window"))
    })
    const appItems: MenuItem[] = []
    if (opts.onNewWindow && !ownNewWindow) {
        appItems.push({ label: "Nueva ventana", icon: "window-new-symbolic", onClick: opts.onNewWindow })
    }
    if (opts.appId) {
        const inMenu = pins.isPinnedMenu(opts.appId)
        const inSidebar = pins.isPinnedSidebar(opts.appId)
        appItems.push({
            label: inMenu ? "Desanclar del menú" : "Anclar al menú",
            icon: inMenu ? "bookmark-remove-symbolic" : "bookmark-new-symbolic",
            onClick: () => pins.toggleMenu(opts.appId),
        })
        appItems.push({
            label: inSidebar ? "Desanclar del sidebar" : "Anclar al sidebar",
            icon: inSidebar ? "view-pin-symbolic" : "pin-symbolic",
            onClick: () => pins.toggleSidebar(opts.appId),
        })
    }
    if (appItems.length > 0) sections.push({ items: appItems })

    // Botones de ventana (sobre la primera ventana de la app)
    const client = opts.clients[0]
    let winButtons: Gtk.Button[] = []
    if (client) {
        const addr = addrOf(client)
        const min = windowButton("window-minimize-symbolic", "Minimizar")
        const float = windowButton("window-pop-out-symbolic", "Flotante")
        const close = windowButton("window-close-symbolic", "Cerrar", true)
        min.connect("clicked", () => hyprland.dispatch("movetoworkspacesilent", `special:minimized,address:${addr}`))
        float.connect("clicked", () => hyprland.dispatch("togglefloating", `address:${addr}`))
        close.connect("clicked", () => hyprland.dispatch("closewindow", `address:${addr}`))
        winButtons = [min, float, close]
        const row = new Gtk.Box({ spacing: 4, homogeneous: true, cssClasses: ["app-menu-win-row"] })
        winButtons.forEach(b => row.append(b))
        sections.push({ customChild: row })
    }

    const popover = MenuPopover(widget, sections, position)
    popover.add_css_class("app-menu")
    winButtons.forEach(b => b.connect("clicked", () => popover.popdown()))
    return popover
}

// Abre el menú con clic derecho, rearmándolo en cada apertura para que los
// anclajes y las ventanas estén al día.
export function attachAppMenu(widget: Gtk.Widget, build: () => Gtk.Popover) {
    let popover: Gtk.Popover | null = null
    const gesture = new Gtk.GestureClick({ button: 3 })
    gesture.connect("released", () => {
        if (popover) popover.unparent()
        popover = build()
        popover.popup()
    })
    widget.add_controller(gesture)
}
