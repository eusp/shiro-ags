import { Gtk } from "ags/gtk4"
import { exec, execAsync } from "ags/process"
import GLib from "gi://GLib?version=2.0"

const LAYOUTS: Record<string, string> = {
    us: "EN",
    es: "ES",
}

function readLayout(): string {
    try {
        const out = exec("hyprctl getoption input:kb_layout")
        const match = out.match(/str:\s*(\S+)/)
        return match?.[1] || "us"
    } catch {
        return "us"
    }
}

export default function KeyboardLayout() {
    const label = new Gtk.Label({ cssClasses: ["kb-layout-label"] })

    const button = new Gtk.Button({ cssClasses: ["kb-layout-button"] })
    button.set_child(label)

    const update = () => {
        const layout = readLayout()
        label.label = LAYOUTS[layout] || layout.toUpperCase()
        button.tooltipText = layout === "es" ? "Español" : "English"
    }

    button.connect("clicked", () => {
        const next = readLayout() === "es" ? "us" : "es"
        execAsync(`hyprctl keyword input:kb_layout ${next}`)
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
