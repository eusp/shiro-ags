import { Gtk } from "ags/gtk4"
import Tray, { TrayItem, MenuNode } from "../../lib/tray"
import { MenuPopover } from "../Shared/MenuPopover"
import { findAppMatch } from "../../lib/icons"

const tray = Tray.get_default()

// "_Salir" → "Salir" (los mnemónicos de dbusmenu); "__" queda como "_"
const cleanLabel = (s: string) => s.replace(/__/g, "\u0000").replace(/_/g, "").replace(/\u0000/g, "_")

// Abre la app: primero con Activate; si no lo implementa (Steam y otras de
// Ayatana), con su .desktop, que en una app ya abierta trae su ventana.
function openApp(item: TrayItem) {
    item.activate(() => {
        const { desktopApp } = findAppMatch(item.appId.toLowerCase() || item.title.toLowerCase())
        try { desktopApp?.launch([], null) } catch (e) { logError(e as Error, `tray: no se pudo abrir ${item.title}`) }
    })
}

// Menú de la app con el mismo estilo que los demás de la barra. Las
// opciones son las que manda la app; los submenús son páginas de un
// Gtk.Stack homogéneo, así el popover no cambia de tamaño al entrar en
// ellos (Hyprland lo cerraría).
function buildMenu(btn: Gtk.Widget, item: TrayItem): Gtk.Popover {
    const stack = new Gtk.Stack({
        hhomogeneous: true,
        vhomogeneous: true,
        transitionType: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
        transitionDuration: 150,
    })
    let popover: Gtk.Popover | null = null
    let pageCount = 0

    const row = (label: string, opts: { icon?: string; trailing?: string; trailingOn?: boolean; enabled?: boolean; onClick: () => void }) => {
        const box = new Gtk.Box({ spacing: 10 })
        if (opts.icon) box.append(new Gtk.Image({ iconName: opts.icon }))
        box.append(new Gtk.Label({ label, xalign: 0, hexpand: true, ellipsize: 3, maxWidthChars: 26 }))
        if (opts.trailing) box.append(new Gtk.Image({ iconName: opts.trailing, cssClasses: ["popover-check"], opacity: opts.trailingOn === false ? 0 : 1 }))
        const b = new Gtk.Button({ cssClasses: ["popover-item"], child: box, sensitive: opts.enabled !== false })
        b.connect("clicked", opts.onClick)
        return b
    }
    const separator = () => new Gtk.Separator({ cssClasses: ["popover-separator"] })

    const renderNodes = (nodes: MenuNode[], page: Gtk.Box) => {
        let lastWasSep = true
        for (const node of nodes) {
            const p = node.properties || {}
            if (p.visible === false) continue
            if (p.type === "separator") {
                if (!lastWasSep) page.append(separator())
                lastWasSep = true
                continue
            }
            lastWasSep = false
            const label = cleanLabel(typeof p.label === "string" && p.label ? p.label : "…")
            const icon = typeof p["icon-name"] === "string" && p["icon-name"] ? p["icon-name"] : undefined

            if (node.children?.length || p["children-display"] === "submenu") {
                const name = `sub-${pageCount++}`
                const sub = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
                sub.append(row(label, { icon: "go-previous-symbolic", onClick: () => stack.set_visible_child_name("main") }))
                sub.append(separator())
                renderNodes(node.children || [], sub)
                stack.add_named(sub, name)
                page.append(row(label, { icon, trailing: "go-next-symbolic", enabled: p.enabled !== false, onClick: () => stack.set_visible_child_name(name) }))
                continue
            }

            const toggle = p["toggle-type"] === "checkmark" || p["toggle-type"] === "radio"
            page.append(row(label, {
                icon,
                trailing: toggle ? (p["toggle-type"] === "radio" ? "media-record-symbolic" : "object-select-symbolic") : undefined,
                trailingOn: toggle ? p["toggle-state"] === 1 : undefined,
                enabled: p.enabled !== false,
                onClick: () => { item.click(node.id); popover?.popdown() },
            }))
        }
        // Sin separador colgando al final
        const last = page.get_last_child()
        if (last instanceof Gtk.Separator) page.remove(last)
    }

    const main = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    main.append(row(`Abrir ${item.title}`, { icon: "window-new-symbolic", onClick: () => { openApp(item); popover?.popdown() } }))
    if (item.layout?.children?.length) {
        main.append(separator())
        renderNodes(item.layout.children, main)
    }
    stack.add_named(main, "main")
    stack.set_visible_child_name("main")

    // Menús muy largos: scroll en vez de salirse de la pantalla
    const scrolled = new Gtk.ScrolledWindow({
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        propagateNaturalHeight: true,
        maxContentHeight: 520,
        child: stack,
    })

    popover = MenuPopover(btn, [{ title: item.title || "App", titleGicon: item.gicon ?? undefined, customChild: scrolled }])
    popover.add_css_class("topbar-menu")
    return popover
}

export default function SysTray() {
    const list = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6
    })

    const update = () => {
        while (list.get_first_child()) {
            list.remove(list.get_first_child()!)
        }

        tray.items.forEach((item: TrayItem) => {
            const btn = new Gtk.Button({ cssClasses: ["tray-btn"], tooltipText: item.title })
            btn.set_child(new Gtk.Image({ gicon: item.gicon }))

            // Clic izquierdo o derecho: abre el menú (rearmado cada vez, con
            // lo último que mandó la app). Si algo falla, el menú nativo.
            let popover: Gtk.Popover | null = null
            const open = () => {
                popover?.unparent()
                item.refreshMenuAsync()  // para la próxima apertura; esta usa lo último recibido
                try {
                    popover = buildMenu(btn, item)
                } catch (e) {
                    logError(e as Error, `tray: menú propio falló para ${item.title}, se usa el nativo`)
                    if (!item.menu_model) return
                    popover = Gtk.PopoverMenu.new_from_model(item.menu_model)
                    popover.add_css_class("shared-popover")
                    popover.add_css_class("systray-popover")
                    if (item.action_group) btn.insert_action_group("dbusmenu", item.action_group)
                    popover.set_parent(btn)
                }
                popover.popup()
            }
            btn.connect("clicked", open)
            const right = new Gtk.GestureClick({ button: 3 })
            right.connect("released", open)
            btn.add_controller(right)

            list.append(btn)
        })
        // Vacía no se muestra: si no, la barra deja un hueco doble entre íconos
        list.visible = tray.items.length > 0
    }

    tray.connect("notify::items", update)
    update()

    return list
}
