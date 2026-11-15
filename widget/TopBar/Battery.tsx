import { Gtk } from "ags/gtk4"
import Battery, { BatteryState } from "../../lib/battery"

const battery = Battery.get_default()

// Con cargador (cargando, llena o en pausa por el modo conservación) la
// laptop funciona con la corriente: el indicador toma el color del tema.
const ON_AC = [BatteryState.CHARGING, BatteryState.FULLY_CHARGED, BatteryState.PENDING_CHARGE]

// El IconName de UPower no sirve: dice "full-charging" aunque esté al 50% y en
// Papirus sale verde, sin tomar el color del CSS. Se arma con el porcentaje;
// el rayo aparece solo mientras de verdad está cargando.
function iconFor(pct: number, charging: boolean) {
    const level = Math.min(100, Math.max(0, Math.floor(pct / 10) * 10))
    return `battery-level-${level}${charging ? "-charging" : ""}-symbolic`
}

export default function BatteryIndicator() {
    const box = new Gtk.Box({ spacing: 4, cssClasses: ["battery"] })
    const icon = new Gtk.Image()
    const label = new Gtk.Label()

    box.append(icon)
    box.append(label)

    const update = () => {
        box.visible = battery.isPresent
        const pct = Math.floor(battery.percentage * 100)
        const charging = battery.state === BatteryState.CHARGING
        const onAc = ON_AC.includes(battery.state)
        icon.iconName = battery.isPresent ? iconFor(pct, charging) : "battery-missing-symbolic"
        label.label = battery.isPresent ? `${pct}%` : ""
        if (onAc) box.add_css_class("on-ac")
        else box.remove_css_class("on-ac")
        box.tooltipText = charging ? "Con corriente, cargando"
            : onAc ? "Con corriente, sin cargar"
            : "Con batería"
    }

    battery.connect("notify::percentage", update)
    battery.connect("notify::state", update)
    battery.connect("notify::is-present", update)
    box.connect("map", update)

    return box
}
