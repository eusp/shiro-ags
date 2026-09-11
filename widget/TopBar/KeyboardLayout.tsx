import { Gtk } from "ags/gtk4"
import { exec, execAsync } from "ags/process"
import GLib from "gi://GLib?version=2.0"

const LAYOUTS: Record<string, string> = {
    us: "EN",
    es: "ES",
}

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

function readActiveLayout(): string {
    const keymap: string = getMainKeyboard()?.active_keymap || ""
    return keymap.toLowerCase().includes("spanish") ? "es" : "us"
}

export default function KeyboardLayout() {
    const label = new Gtk.Label({ cssClasses: ["kb-layout-label"] })

    const button = new Gtk.Button({ cssClasses: ["kb-layout-button"] })
    button.set_child(label)

    const update = () => {
        const layout = readActiveLayout()
        label.label = LAYOUTS[layout] || layout.toUpperCase()
        button.tooltipText = layout === "es" ? "Español" : "English"
    }

    button.connect("clicked", () => {
        const device = getKeyboardDevice()
        if (!device) return
        execAsync(["hyprctl", "switchxkblayout", device, "next"])
            .then(update)
            .catch(() => { })
    })

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update()
        return GLib.SOURCE_CONTINUE
    })

    update()

    return button
}
