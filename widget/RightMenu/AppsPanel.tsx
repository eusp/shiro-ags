import { Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Hyprland from "../../lib/hyprland"
import Apps from "../../lib/apps"
import { MenuPopover, MenuItem, MenuSection } from "../Shared/MenuPopover"
import pins from "../../lib/pins"

declare const imports: any

const { Gio, GLib, GObject } = imports.gi
const ByteArray = imports.byteArray

const hyprland = Hyprland.get_default()
const apps = new Apps()
// Referencia a nivel de módulo: si se recolecta, deja de emitir "changed"
const appInfoMonitor = Gio.AppInfoMonitor.get()

// Panel de apps a toda la altura del RightMenu (RightMenu oculta lo de arriba)
const appsExpandedSubs: ((v: boolean) => void)[] = []
let appsExpandedValue = false
export const appsExpanded = {
    get: () => appsExpandedValue,
    set: (v: boolean) => { appsExpandedValue = v; appsExpandedSubs.forEach(fn => fn(v)) },
    subscribe: (fn: (v: boolean) => void) => { appsExpandedSubs.push(fn) },
}

function launchDetached(command: string) {
    const { Gio } = imports.gi;
    try {
        new Gio.Subprocess({
            argv: [command],
        }).init(null);
    } catch (e) {
        // @ts-ignore
        if (typeof print !== 'undefined') print(e);
    }
}

function tryGetAppInfo(id: string) {
    if (!id) return null
    // @ts-ignore
    const DesktopAppInfo = (imports.gi.GioUnix ? imports.gi.GioUnix.DesktopAppInfo : Gio.DesktopAppInfo)
    const di = DesktopAppInfo.new(id) ||
        DesktopAppInfo.new(id + ".desktop") ||
        DesktopAppInfo.new("org.mozilla." + id) ||
        DesktopAppInfo.new("org.gnome." + (id === "nautilus" ? "Nautilus" : id))
    return di
}

function createContextMenu(widget: Gtk.Widget, appInfo: any) {
    const sections: MenuSection[] = []
    const appId = appInfo.get_id ? appInfo.get_id() : ""
    const desktopAppInfo = tryGetAppInfo(appId)
    const appName = desktopAppInfo?.get_display_name()
        || (appInfo.get_display_name && appInfo.get_display_name())
        || (appInfo.get_name && appInfo.get_name())
        || appId

    // 1. Desktop Actions (Jump Lists)
    if (desktopAppInfo) {
        // @ts-ignore
        const actions = desktopAppInfo.list_actions ? desktopAppInfo.list_actions() : []
        if (actions.length > 0) {
            sections.push({
                title: appName,
                items: actions.map((name: any) => ({
                    label: (desktopAppInfo as any).get_action_name(name) || name,
                    icon: "system-run-symbolic",
                    onClick: () => {
                        // @ts-ignore
                        if (desktopAppInfo.launch_action) desktopAppInfo.launch_action(name, null)
                    }
                }))
            })
        }
    }

    // 2. Pinning Options
    const pinningItems: MenuItem[] = []
    const isPinnedMenu = pins.isPinnedMenu(appId)
    const isPinnedSidebar = pins.isPinnedSidebar(appId)

    pinningItems.push({
        label: isPinnedMenu ? "Desanclar del menú" : "Anclar al menú",
        icon: isPinnedMenu ? "bookmark-remove-symbolic" : "bookmark-new-symbolic",
        onClick: () => pins.toggleMenu(appId)
    })

    pinningItems.push({
        label: isPinnedSidebar ? "Desanclar del sidebar" : "Anclar al sidebar",
        icon: isPinnedSidebar ? "pin-symbolic" : "bookmark-new-symbolic",
        onClick: () => pins.toggleSidebar(appId)
    })

    sections.push({ items: pinningItems })

    // 3. Window Management
    const desktopApp = apps.list.find((a: any) => a.id === appId)
    const match = desktopApp?.wm_class?.toLowerCase() || desktopApp?.name?.toLowerCase() || appId.split(".")[0]
    const client = hyprland.clients.find((c: any) => (c.class?.toLowerCase() || "").includes(match))

    const windowItems: MenuItem[] = []

    windowItems.push({
        label: "Nueva ventana",
        icon: "window-new-symbolic",
        onClick: () => {
            const cmd = appInfo.get_executable ? appInfo.get_executable() : null
            if (cmd) launchDetached(cmd)
        }
    })

    if (client) {
        const addr = client.address.startsWith("0x") ? client.address : `0x${client.address}`

        windowItems.push({
            label: "Minimizar",
            icon: "window-minimize-symbolic",
            onClick: () => hyprland.dispatch("movetoworkspacesilent", `special:minimized,address:${addr}`)
        })

        windowItems.push({
            label: "Flotante",
            icon: "window-pop-out-symbolic",
            onClick: () => hyprland.dispatch("togglefloating", `address:${addr}`)
        })

        windowItems.push({
            label: "Cerrar",
            icon: "window-close-symbolic",
            onClick: () => hyprland.dispatch("closewindow", `address:${addr}`),
            isDangerous: true
        })
    }

    sections.push({ items: windowItems })

    // El nombre de la app va siempre arriba, tenga o no acciones propias
    if (!sections[0].title) sections[0].title = appName

    return MenuPopover(widget, sections, Gtk.PositionType.LEFT)
}

export default function AppsPanel() {
    const loadInstalledApps = (): any[] => (Gio.AppInfo.get_all() || [])
        .filter((a: any) => a && a.should_show && a.should_show())
    let allInstalledApps = loadInstalledApps()

    const findById = (id: string) => allInstalledApps.find((a: any) => a.get_id && a.get_id() === id)

    const getDisplayName = (appInfo: any) => (appInfo.get_display_name && appInfo.get_display_name())
        || (appInfo.get_name && appInfo.get_name())
        || "App"

    const launchApp = (appInfo: any) => {
        try {
            appInfo.launch([], null)
        } catch {
            const cmd = appInfo.get_executable ? appInfo.get_executable() : null
            if (cmd) execAsync(cmd).catch(() => { })
        }
    }

    // ── Helper: crea un FlowBox con configuración idéntica ──────────────────
    const createAppFlow = (extraClasses: string[] = []) => new Gtk.FlowBox({
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 8,
        rowSpacing: 8,
        homogeneous: true,
        minChildrenPerLine: 4,
        maxChildrenPerLine: 4,
        hexpand: true,
        vexpand: false,
        // Arriba y con altura natural: con pocas apps las filas no se estiran
        // para llenar los 225px, queda espacio libre debajo
        valign: Gtk.Align.START,
        cssClasses: ["apps-grid", ...extraClasses],
    })
    const createAppTile = (appInfo: any, cssClasses: string[] = ["app-tile"]) => {
        const displayName = getDisplayName(appInfo)
        const iconObj = appInfo.get_icon ? appInfo.get_icon() : null

        const btn = new Gtk.Button({ cssClasses })

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        })

        const icon = new Gtk.Image({ pixelSize: 32 })
        if (iconObj) icon.set_from_gicon(iconObj)

        const name = new Gtk.Label({
            label: displayName,
            cssClasses: ["app-tile-name"],
            ellipsize: 3,
            maxWidthChars: 10,
            justify: Gtk.Justification.CENTER,
            halign: Gtk.Align.CENTER,
        })

        box.append(icon)
        box.append(name)
        btn.set_child(box)

        btn.connect("clicked", () => launchApp(appInfo))

        // Context Menu (Lazy Loaded)
        let popover: any = null
        const gesture = new Gtk.GestureClick({ button: 3 })
        gesture.connect("released", () => {
            if (!popover) {
                popover = createContextMenu(btn, appInfo)
            }
            popover.popup()
        })
        btn.add_controller(gesture)

        return btn
    }

    // Arrastrar una anclada sobre otra la pone en su lugar
    const makeReorderable = (btn: Gtk.Button, pinId: string) => {
        const source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })
        source.connect("prepare", () => Gdk.ContentProvider.new_for_value(pinId))
        source.connect("drag-begin", () => {
            source.set_icon(Gtk.WidgetPaintable.new(btn), 0, 0)
            btn.add_css_class("dragging")
        })
        source.connect("drag-end", () => btn.remove_css_class("dragging"))
        btn.add_controller(source)

        const target = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE)
        target.connect("enter", () => {
            btn.add_css_class("drop-target")
            return Gdk.DragAction.MOVE
        })
        target.connect("leave", () => btn.remove_css_class("drop-target"))
        target.connect("drop", (_t: any, value: string) => {
            btn.remove_css_class("drop-target")
            // Se difiere: menu-changed reconstruye la grilla y destruiría este botón en pleno drop
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                pins.moveMenu(value, pinId)
                return false
            })
            return true
        })
        btn.add_controller(target)
    }

    const root = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        cssClasses: ["apps-panel"],
    })

    const searchEntry = new Gtk.Entry({
        placeholderText: "Buscar aplicaciones...",
        cssClasses: ["app-search"],
        hexpand: true,
    })

    // ── FlowBoxes con configuración unificada ────────────────────────────────
    const flow = createAppFlow()
    const pinnedFlow = createAppFlow(["pinned-grid"])

    const noResultsLabel = new Gtk.Label({
        label: "No se encontraron aplicaciones",
        cssClasses: ["no-results-label"],
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        visible: false,
    })

    const scrolled = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: false,          // ← quitar el vexpand
    })
    scrolled.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
    scrolled.set_child(flow)
    scrolled.set_min_content_height(225)
    scrolled.set_max_content_height(225)
    scrolled.set_propagate_natural_height(true)

    // Misma altura fija que los resultados: con muchas ancladas se hace scroll
    // en vez de crecer y empujar el buscador y los botones fuera de la pantalla
    const pinnedSection = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: false,
        cssClasses: ["pinned-section"],
    })
    pinnedSection.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
    pinnedSection.set_child(pinnedFlow)
    pinnedSection.set_min_content_height(225)
    pinnedSection.set_max_content_height(225)

    const updatePinned = () => {
        while (pinnedFlow.get_first_child()) {
            pinnedFlow.remove(pinnedFlow.get_first_child()!)
        }

        const currentPins = pins.getMenu()
        currentPins.forEach(id => {
            const app = findById(id)
            if (!app) return
            const tile = createAppTile(app, ["app-tile", "pinned-tile"])
            makeReorderable(tile, id)
            pinnedFlow.insert(tile, -1)
        })
        // Si se ancló desde la búsqueda o desde "todas las apps", esa vista
        // sigue abierta: las ancladas solo se muestran cuando no hay otra
        pinnedSection.visible = currentPins.length > 0 && !scrolled.visible && !noResultsLabel.visible
    }

    pins.connect("menu-changed", updatePinned)
    updatePinned()

    let firstHighlightedApp: any = null

    const sortApps = () => [...allInstalledApps].sort((a: any, b: any) =>
        getDisplayName(a).localeCompare(getDisplayName(b)))
    let sortedApps = sortApps()

    const showAll = () => {
        while (flow.get_first_child()) flow.remove(flow.get_first_child()!)
        firstHighlightedApp = null
        sortedApps.forEach((a) => flow.append(createAppTile(a)))
        scrolled.visible = true
        noResultsLabel.visible = false
        pinnedSection.visible = false
    }

    const render = () => {
        const q = searchEntry.get_text().trim().toLowerCase()
        while (flow.get_first_child()) flow.remove(flow.get_first_child()!)
        firstHighlightedApp = null

        // Expandido y sin búsqueda: todas las apps en vez de las ancladas
        if (q.length === 0 && appsExpanded.get()) {
            showAll()
            return
        }

        if (q.length === 0) {
            scrolled.visible = false
            noResultsLabel.visible = false
            pinnedSection.visible = pins.getMenu().length > 0
            return
        }

        scrolled.visible = true
        pinnedSection.visible = false

        const filtered = allInstalledApps
            .filter((a: any) => {
                const name = getDisplayName(a)
                return name.toLowerCase().includes(q)
            })
            .slice(0, 60)

        if (filtered.length === 0) {
            scrolled.visible = false
            noResultsLabel.visible = true
            return
        }

        noResultsLabel.visible = false

        filtered.forEach((app, index) => {
            if (index === 0) {
                firstHighlightedApp = app
                flow.append(createAppTile(app, ["app-tile", "highlighted"]))
            } else {
                flow.append(createAppTile(app))
            }
        })
    }

    searchEntry.connect("activate", () => {
        if (firstHighlightedApp) launchApp(firstHighlightedApp)
    })

    searchEntry.connect("changed", render)

    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        cssClasses: ["search-box"],
    })
    searchBox.append(searchEntry)

    const menuButton = new Gtk.Button({
        cssClasses: ["menu-button"],
        child: new Gtk.Image({ iconName: "view-grid-symbolic" })
    })

    // Ver todas las apps expande el panel a todo el RightMenu; otro clic lo contrae
    menuButton.connect("clicked", () => appsExpanded.set(!appsExpanded.get()))
    searchBox.append(menuButton)

    // Expandido: las vistas dejan la altura fija de 225px y llenan el panel
    appsExpanded.subscribe(expanded => {
        if (expanded) menuButton.add_css_class("active")
        else menuButton.remove_css_class("active")
        root.vexpand = expanded
        for (const view of [scrolled, pinnedSection]) {
            view.vexpand = expanded
            view.set_max_content_height(expanded ? -1 : 225)
        }
        noResultsLabel.vexpand = expanded
        searchEntry.set_text("")
        render()
    })

    root.append(pinnedSection)
    root.append(noResultsLabel)
    root.append(scrolled)
    root.append(searchBox)

    // Al instalar o desinstalar apps cambian los .desktop: se recarga la lista
    // sin reiniciar AGS. Llega en ráfagas, así que se agrupa con un retardo corto
    let reloadId = 0
    appInfoMonitor.connect("changed", () => {
        if (reloadId) GLib.source_remove(reloadId)
        reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            reloadId = 0
            allInstalledApps = loadInstalledApps()
            sortedApps = sortApps()
            updatePinned()
            render()
            return false
        })
    })

    render()

    // @ts-ignore
    root.searchEntry = searchEntry

    return root
}