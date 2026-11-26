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

// ── Acciones sobre una ventana concreta (las usa también la sidebar) ──
export const isHidden = (c: Client) => (c.workspace?.name || "").includes("minimized")

export function hideWindow(c: Client) {
    hyprland.dispatch("movetoworkspacesilent", `special:minimized,address:${addrOf(c)}`)
}

// Enfoca la ventana; si estaba oculta, la trae al workspace actual
export function focusWindow(c: Client) {
    if (isHidden(c)) {
        const ws = hyprland.focusedWorkspace
        hyprland.dispatch("movetoworkspace", `${ws ? ws.id : "+0"},address:${addrOf(c)}`)
    }
    c.focus()
}

// Clic en el ícono de una app con varias ventanas: elige la que esperas.
//   1. la enfocada es de esta app → se oculta
//   2. hay una en este workspace → se enfoca (la usada más recientemente)
//   3. hay alguna oculta → se restaura la última usada
//   4. si no → se va a la más reciente, en su workspace
export function toggleAppWindows(wins: Client[]) {
    if (wins.length === 0) return
    const focused = hyprland.focusedClient
    const wsId = hyprland.focusedWorkspace?.id
    const recent = [...wins].sort((a, b) => a.focusHistoryID - b.focusHistoryID)

    const current = focused && wins.find(c => c.address === focused.address)
    if (current) return hideWindow(current)
    const here = recent.find(c => c.workspace.id === wsId)
    if (here) return focusWindow(here)
    const hidden = recent.find(isHidden)
    if (hidden) return focusWindow(hidden)
    focusWindow(recent[0])
}

const isPrivate = (title: string) => /privad|private|inc[oó]gnit/i.test(title)

// "Página — Mozilla Firefox" → "Página" (si el final repite el nombre de la app)
function windowTitle(title: string, appName: string): string {
    const m = title.match(/^(.*?)\s+[—–-]\s+([^—–-]+)$/)
    if (m && appName && m[2].toLowerCase().includes(appName.toLowerCase().split(" ").pop()!)) return m[1] || title
    return title || appName
}

// Trae la ventana al workspace actual (en vez de ir al suyo) y la enfoca
export function bringWindowHere(c: Client) {
    const ws = hyprland.focusedWorkspace
    hyprland.dispatch("movetoworkspace", `${ws ? ws.id : "+0"},address:${addrOf(c)}`)
    c.focus()
}

// Una línea por ventana: [antifaz] título ··· workspace. Al pasar el mouse
// aparecen Traer aquí (si está en otro workspace), Ocultar y Cerrar.
function windowRows(opts: AppMenuOptions, closePopover: () => void): Gtk.Box {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    const focused = hyprland.focusedClient
    const wsId = hyprland.focusedWorkspace?.id
    const sorted = [...opts.clients].sort((a, b) => a.focusHistoryID - b.focusHistoryID)
    for (const c of sorted) {
        const hidden = isHidden(c)
        const isCurrent = focused?.address === c.address
        const elsewhere = !hidden && c.workspace.id !== wsId

        const inner = new Gtk.Box({ spacing: 8 })
        if (isPrivate(c.title)) inner.append(new Gtk.Image({ iconName: "user-not-tracked-symbolic", cssClasses: ["app-menu-private"], tooltipText: "Ventana privada" }))
        inner.append(new Gtk.Label({ label: windowTitle(c.title, opts.name), xalign: 0, hexpand: true, ellipsize: 3, maxWidthChars: 20 }))
        const badge = hidden
            ? new Gtk.Image({ iconName: "view-conceal-symbolic", cssClasses: ["app-menu-ws-badge", "hidden"], tooltipText: "Oculta" })
            : new Gtk.Label({ label: String(c.workspace.id), cssClasses: ["app-menu-ws-badge"], tooltipText: `Workspace ${c.workspace.id}` })
        inner.append(badge)

        // Alto fijo: con pastilla de texto o de ícono, todas las filas iguales
        const main = new Gtk.Button({ cssClasses: ["popover-item", "app-menu-win", ...(isCurrent ? ["current"] : [])], child: inner, hexpand: true, tooltipText: c.title, heightRequest: 32 })
        main.connect("clicked", () => { focusWindow(c); closePopover() })

        // Acciones: aparecen al pasar el mouse, SUPERPUESTAS sobre el extremo
        // derecho de la fila (Gtk.Overlay). No ocupan lugar, así el menú no
        // cambia de tamaño; si cambiara, GTK lo reubica y salta.
        const actions = new Gtk.Box({ spacing: 0, visible: false, halign: Gtk.Align.END, valign: Gtk.Align.CENTER, cssClasses: ["app-menu-win-actions"] })
        const act = (icon: string, tip: string, fn: () => void, dangerous = false) => {
            const b = new Gtk.Button({ cssClasses: ["app-menu-win-btn-sm", ...(dangerous ? ["dangerous"] : [])], iconName: icon, tooltipText: tip, valign: Gtk.Align.CENTER })
            b.connect("clicked", () => { fn(); closePopover() })
            actions.append(b)
        }
        if (hidden) act("view-reveal-symbolic", "Mostrar aquí", () => focusWindow(c))
        if (elsewhere) act("go-jump-symbolic", "Traer a este workspace", () => bringWindowHere(c))
        if (!hidden) act("window-minimize-symbolic", "Ocultar", () => hideWindow(c))
        act("window-close-symbolic", "Cerrar", () => hyprland.dispatch("closewindow", `address:${addrOf(c)}`), true)

        const row = new Gtk.Overlay({ child: main })
        row.add_overlay(actions)
        const hover = new Gtk.EventControllerMotion()
        hover.connect("enter", () => { actions.visible = true; badge.opacity = 0 })
        hover.connect("leave", () => { actions.visible = false; badge.opacity = 1 })
        row.add_controller(hover)
        box.append(row)
    }
    return box
}

function header(opts: AppMenuOptions) {
    const image = new Gtk.Image({ pixelSize: 28, cssClasses: ["app-menu-icon"] })
    if (opts.icon instanceof Gio.Icon) image.set_from_gicon(opts.icon)
    else image.set_from_icon_name(opts.icon || "application-x-executable")

    const n = opts.clients.length
    const hiddenN = opts.clients.filter(isHidden).length
    const status = n === 0 ? "Sin abrir" : n === 1 ? (hiddenN ? "Oculta" : "Abierta") : `${n} ventanas${hiddenN ? ` · ${hiddenN} oculta${hiddenN > 1 ? "s" : ""}` : ""}`

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
    let popoverRef: Gtk.Popover | null = null
    // Varias ventanas: la lista va primero, es lo que más se usa
    if (opts.clients.length > 1) {
        sections.push({ customChild: windowRows(opts, () => popoverRef?.popdown()) })
    }

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

    // Una sola ventana: Minimizar/Flotante/Cerrar al final
    const client = opts.clients.length === 1 ? opts.clients[0] : null
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
    popoverRef = popover
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
