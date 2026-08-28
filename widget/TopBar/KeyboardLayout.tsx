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
function getKeyboardDevice(): string | null {
    try {
        const data = JSON.parse(exec("hyprctl devices -j"))
        return data?.keyboards?.[0]?.name || null
    } catch {
        return null
    }
}

function readActiveLayout(): string {
    try {
        const data = JSON.parse(exec("hyprctl devices -j"))
        const keymap: string = data?.keyboards?.[0]?.active_keymap || ""
        return keymap.toLowerCase().includes("spanish") ? "es" : "us"
    } catch {
        return "us"
    }
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
