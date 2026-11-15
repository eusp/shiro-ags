import { Gtk } from "ags/gtk4"
import Battery, { BatteryState } from "../../lib/battery"

const battery = Battery.get_default()

// Con cargador (cargando, llena o en pausa por el modo conservación) la
// laptop funciona con la corriente: se muestra un enchufe y el color cambia.
const ON_AC = [BatteryState.CHARGING, BatteryState.FULLY_CHARGED, BatteryState.PENDING_CHARGE]

export default function BatteryIndicator() {
    const box = new Gtk.Box({ spacing: 4, cssClasses: ["battery"] })
    const icon = new Gtk.Image()
    const label = new Gtk.Label()
    const plug = new Gtk.Image({ iconName: "ac-adapter-symbolic", cssClasses: ["battery-plug"] })

    box.append(icon)
    box.append(label)
    box.append(plug)

    const update = () => {
        box.visible = battery.isPresent
        icon.iconName = battery.iconName || "battery-missing-symbolic"
        label.label = battery.isPresent ? `${Math.floor(battery.percentage * 100)}%` : ""
        const onAc = ON_AC.includes(battery.state)
        plug.visible = onAc
        if (onAc) box.add_css_class("on-ac")
        else box.remove_css_class("on-ac")
        box.tooltipText = onAc ? "Con corriente" : "Con batería"
    }

    battery.connect("notify::percentage", update)
    battery.connect("notify::icon-name", update)
    battery.connect("notify::is-present", update)
    battery.connect("notify::state", update)
    box.connect("map", update)

    return box
}
