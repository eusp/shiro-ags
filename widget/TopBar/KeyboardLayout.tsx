import { Gtk } from "ags/gtk4"
import { exec, execAsync } from "ags/process"
import GLib from "gi://GLib?version=2.0"
import { MenuPopover } from "../Shared/MenuPopover"

// Código corto (barra) y nombre (menú) de cada distribución
const LAYOUTS: Record<string, { code: string; name: string }> = {
    us: { code: "EN", name: "English (US)" },
    es: { code: "ES", name: "Español" },
    latam: { code: "LA", name: "Español (Latinoamérica)" },
    fr: { code: "FR", name: "Français" },
    de: { code: "DE", name: "Deutsch" },
    pt: { code: "PT", name: "Português" },
    br: { code: "BR", name: "Português (Brasil)" },
    it: { code: "IT", name: "Italiano" },
    jp: { code: "JA", name: "日本語" },
}
const layoutInfo = (id: string) => LAYOUTS[id] ?? { code: id.toUpperCase(), name: id }

// hyprctl keyword no funciona con el config en Lua de este sistema
// ("keyword can't work with non-legacy parsers"), así que hay que usar
// switchxkblayout sobre el dispositivo real en vez de tocar la opción.
//
// "hyprctl devices -j" lista un montón de "teclados" (el mouse gamer con
// teclas propias, cada sub-interfaz HID del teclado mecánico —base,
// controles de sistema, multimedia—, los botones de power, etc.), y
// keyboards[0] no es de fiar: ese índice puede caer en cualquiera de
// esos dispositivos secundarios en vez del teclado real. Por eso el
// botón cambiaba de idioma un dispositivo que nadie usa para escribir,
// mientras el teclado real (el único que Hyprland marca con
// "main": true) seguía siempre en inglés. Hay que buscar ese, no
// asumir el primero de la lista.
function getMainKeyboard(): any | null {
    try {
        const data = JSON.parse(exec("hyprctl devices -j"))
        const keyboards: any[] = data?.keyboards || []
        return keyboards.find(k => k?.main) || keyboards[0] || null
    } catch {
        return null
    }
}

function getKeyboardDevice(): string | null {
    return getMainKeyboard()?.name || null
}

// Distribuciones configuradas en Hyprland ("us,es") y cuál está activa
function readLayouts(): { ids: string[]; active: number } {
    const kb = getMainKeyboard()
    const ids = String(kb?.layout || "us").split(",").map((x: string) => x.trim()).filter(Boolean)
    return { ids, active: kb?.active_layout_index ?? 0 }
}

export default function KeyboardLayout() {
    const label = new Gtk.Label({ cssClasses: ["kb-layout-label"] })
    const button = new Gtk.MenuButton({ cssClasses: ["kb-layout-button"], child: label })

    // ── Menú: una fila por distribución, la activa con check ──
    const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })
    body.append(list)

    const popover = MenuPopover(button, [{ title: "Idioma del teclado", titleIcon: "input-keyboard-symbolic", customChild: body }])
    button.set_popover(popover)

    const select = (index: number) => {
        const device = getKeyboardDevice()
        if (!device) return
        execAsync(["hyprctl", "switchxkblayout", device, String(index)])
            .then(update)
            .catch(e => logError(e, "keyboard: switch layout failed"))
        popover.popdown()
    }

    const buildList = () => {
        const { ids, active } = readLayouts()
        while (list.get_first_child()) list.remove(list.get_first_child()!)
        ids.forEach((id, i) => {
            const info = layoutInfo(id)
            const row = new Gtk.Box({ spacing: 10 })
            row.append(new Gtk.Label({ label: info.code, cssClasses: ["kb-layout-code"], widthChars: 3 }))
            row.append(new Gtk.Label({ label: info.name, xalign: 0, hexpand: true }))
            row.append(new Gtk.Image({ iconName: "object-select-symbolic", cssClasses: ["popover-check"], opacity: i === active ? 1 : 0 }))
            const btn = new Gtk.Button({ cssClasses: ["popover-item", ...(i === active ? ["active"] : [])], child: row })
            btn.connect("clicked", () => select(i))
            list.append(btn)
        })
    }
    popover.connect("notify::visible", () => { if (popover.visible) buildList() })

    const update = () => {
        const { ids, active } = readLayouts()
        const info = layoutInfo(ids[active] ?? "us")
        label.label = info.code
        button.tooltipText = `Teclado: ${info.name}`
    }

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update()
        return GLib.SOURCE_CONTINUE
    })

    update()

    popover.add_css_class("topbar-menu")  // mismo ancho que los demás menús de la barra
    return button
}
