import { Gtk } from "ags/gtk4"
import { exec, execAsync } from "ags/process"
import GLib from "gi://GLib?version=2.0"

const POLL_MS = 2000
const DEBOUNCE_MS = 80

let device = ""

function readBrightness(): number | null {
    try {
        const out = exec(`brightnessctl -m -c backlight -l`).trim()
        if (!out) return null
        const [name, , current, , max] = out.split("\n")[0].split(",")
        device = name
        const cur = parseInt(current, 10)
        const maxVal = parseInt(max, 10)
        if (!maxVal) return null
        return cur / maxVal
    } catch {
        return null
    }
}

export default function BrightnessControl() {
    const initial = readBrightness()
    if (initial === null) return <box />

    const icon = new Gtk.Image({
        iconName: "display-brightness-symbolic",
        cssClasses: ["toggle-icon"]
    })

    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        draw_value: false,
        hexpand: true,
        cssClasses: ["toggle-slider"]
    })

    slider.set_range(0, 1)
    slider.set_value(initial)

    let debounceId = 0
    const handlerId = slider.connect("value-changed", () => {
        const val = slider.get_value()
        if (debounceId) GLib.source_remove(debounceId)
        debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            debounceId = 0
            execAsync(`brightnessctl -d ${device} set ${Math.round(val * 100)}%`).catch(() => { })
            return GLib.SOURCE_REMOVE
        })
    })

    // Keep in sync with brightness changed externally (hardware keys, other tools)
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
        if (debounceId) return GLib.SOURCE_CONTINUE
        const val = readBrightness()
        if (val !== null && Math.abs(val - slider.get_value()) > 0.01) {
            slider.handler_block(handlerId)
            slider.set_value(val)
            slider.handler_unblock(handlerId)
        }
        return GLib.SOURCE_CONTINUE
    })

    return (
        <box cssClasses={["quick-settings-item", "brightness-control-item"]} spacing={12}>
            {icon}
            {slider}
        </box>
    )
}
