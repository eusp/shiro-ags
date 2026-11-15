import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib?version=2.0"

// UPS por NUT (upsc). Solo aparece en equipos con NUT configurado (la PC con
// el UPS CDP); en la laptop upsc no existe o falla y el widget queda oculto.
const UPS = "cdp@localhost"
const POLL_S = 5

// Mismos colores fijos que la batería (styles/topbar/_ups.scss)
export default function UpsIndicator() {
    const box = new Gtk.Box({ spacing: 4, cssClasses: ["ups"], visible: false })
    const icon = new Gtk.Image({ iconName: "uninterruptible-power-supply-symbolic" })
    const label = new Gtk.Label()
    box.append(icon)
    box.append(label)

    const update = async () => {
        let out = ""
        try {
            out = await execAsync(["upsc", UPS])
        } catch {
            box.visible = false
            return
        }
        const v: Record<string, string> = {}
        for (const line of out.split("\n")) {
            const i = line.indexOf(": ")
            if (i > 0) v[line.slice(0, i)] = line.slice(i + 2)
        }
        const flags = (v["ups.status"] ?? "").split(" ")
        const onBattery = flags.includes("OB")
        const low = flags.includes("LB")
        const charge = v["battery.charge"] ?? "?"

        box.visible = true
        // Con luz solo el ícono; sin luz se muestra el porcentaje del UPS
        label.visible = onBattery
        label.label = `${charge}%`

        const cls = low ? "critical" : onBattery ? "on-battery" : ""
        for (const c of ["critical", "on-battery"])
            if (c !== cls) box.remove_css_class(c)
        if (cls) box.add_css_class(cls)

        box.tooltipText = [
            low ? "UPS: batería baja, la PC se apagará sola"
                : onBattery ? "UPS: sin luz, funcionando con batería"
                : "UPS: con luz",
            `Batería: ${charge}%`,
            `Carga: ${v["ups.load"] ?? "?"}%`,
            `Entrada: ${v["input.voltage"] ?? "?"} V`,
        ].join("\n")
    }

    update()
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_S, () => {
        update()
        return GLib.SOURCE_CONTINUE
    })

    return box
}
