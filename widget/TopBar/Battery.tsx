import { Gtk, Gdk } from "ags/gtk4"
import Battery, { BatteryState } from "../../lib/battery"
import { activeProfile, cycleProfile, onProfileChanged, setProfile, PROFILE_LABEL } from "../../lib/power-profiles"

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

    // Ícono del perfil de energía solo en ahorro o rendimiento;
    // en balanceado no se muestra nada para no recargar la barra
    const profileIcon = new Gtk.Image({ cssClasses: ["battery-profile"] })

    box.append(icon)
    box.append(label)
    box.append(profileIcon)

    // Clic: cambiar de perfil (Ahorro → Balanceado → Rendimiento)
    const click = new Gtk.GestureClick()
    click.connect("released", () => cycleProfile())
    box.add_controller(click)
    box.cursor = Gdk.Cursor.new_from_name("pointer", null)

    // Automático: al desconectar el cargador pasa a ahorro y al conectarlo
    // vuelve a balanceado. Solo en el cambio, así se respeta lo que elijas a mano.
    let wasOnAc: boolean | null = null

    const update = () => {
        box.visible = battery.isPresent
        const pct = Math.floor(battery.percentage * 100)
        const charging = battery.state === BatteryState.CHARGING
        const onAc = ON_AC.includes(battery.state)
        icon.iconName = battery.isPresent ? iconFor(pct, charging) : "battery-missing-symbolic"
        label.label = battery.isPresent ? `${pct}%` : ""
        // Una sola clase de color a la vez (ver styles/topbar/_battery.scss)
        const cls = charging ? "charging"
            : onAc ? "on-ac"
            : pct <= 10 ? "critical"
            : pct <= 20 ? "low"
            : ""
        for (const c of ["charging", "on-ac", "critical", "low"])
            if (c !== cls) box.remove_css_class(c)
        if (cls) box.add_css_class(cls)

        // UNKNOWN aparece de paso al reconectar UPower: no cuenta como cambio
        const known = battery.isPresent && battery.state !== BatteryState.UNKNOWN
        if (known && wasOnAc !== null && onAc !== wasOnAc)
            setProfile(onAc ? "balanced" : "power-saver")
        if (known) wasOnAc = onAc

        const profile = activeProfile()
        profileIcon.visible = profile === "power-saver" || profile === "performance"
        if (profileIcon.visible) profileIcon.iconName = `power-profile-${profile}-symbolic`
        const source = charging ? "Con corriente, cargando"
            : onAc ? "Con corriente, sin cargar"
            : "Con batería"
        box.tooltipText = profile
            ? `${source}\nPerfil: ${PROFILE_LABEL[profile] ?? profile} (clic para cambiar)`
            : source
    }

    battery.connect("notify::percentage", update)
    battery.connect("notify::state", update)
    battery.connect("notify::is-present", update)
    onProfileChanged(update)
    box.connect("map", update)

    return box
}
