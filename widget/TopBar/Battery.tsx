import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import Battery, { BatteryState } from "../../lib/battery"

const battery = Battery.get_default()

// Con cargador (cargando, llena o en pausa por el modo conservación) la
// laptop funciona con la corriente: se muestra un enchufe y el color cambia.
const ON_AC = [BatteryState.CHARGING, BatteryState.FULLY_CHARGED, BatteryState.PENDING_CHARGE]

export default function BatteryIndicator() {
    const box = new Gtk.Box({ spacing: 4, cssClasses: ["battery"] })
    const icon = new Gtk.Image()
    const label = new Gtk.Label()
    // Ícono propio: en Papirus "ac-adapter" es otra batería con rayo y se confunde
    const plug = new Gtk.Image({
        gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${GLib.get_home_dir()}/.config/ags/icons/plug-symbolic.svg`)),
        cssClasses: ["battery-plug"],
    })

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
