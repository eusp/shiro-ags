import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib?version=2.0"
import { execAsync } from "ags/process"

const SCRIPT = `${GLib.get_home_dir()}/.config/ags/scripts/audio-route.sh`
// Mientras se envía, cada cuánto se revisa que el envío siga vivo y se repara
// (un reinicio de PipeWire o un cambio de modo de los auriculares lo cortaba).
const HEAL_S = 10

export default function AudioRoute() {
    const mkBtn = (icon: string, tip: string) => {
        const b = new Gtk.Button({
            cssClasses: ["audio-route-btn"],
            tooltipText: tip,
            hexpand: false,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        })
        b.set_child(new Gtk.Image({ iconName: icon }))
        return b
    }

    const localBtn = mkBtn("audio-speakers-symbolic", "Audio en este dispositivo")
    const sendBtn = mkBtn("network-transmit-symbolic", "Enviar audio a la otra máquina")

    // Asíncrono: con exec() síncrono, si PipeWire se colgaba, se congelaba
    // toda la barra esperando a pactl.
    let state = "local"
    let updating = false
    const update = () => {
        if (updating) return
        updating = true
        execAsync(`bash ${SCRIPT} status`)
            .then((out) => {
                state = out.trim()
                localBtn.cssClasses = state === "local" ? ["audio-route-btn", "active"] : ["audio-route-btn"]
                sendBtn.cssClasses = state === "send" ? ["audio-route-btn", "active"] : ["audio-route-btn"]
            })
            .catch((e) => print(e))
            .finally(() => { updating = false })
    }

    let healing = false
    const heal = () => {
        if (healing || state !== "send") return
        healing = true
        execAsync(`bash ${SCRIPT} heal`)
            .then((out) => { if (out.startsWith("fixed")) print(`audio-route: ${out.trim()}`) })
            .catch((e) => print(e))
            .finally(() => { healing = false; update() })
    }

    const run = (btn: Gtk.Button, arg: string) => {
        btn.sensitive = false
        execAsync(`bash ${SCRIPT} ${arg}`)
            .catch((e) => print(e))
            .finally(() => {
                btn.sensitive = true
                update()
            })
    }

    localBtn.connect("clicked", () => run(localBtn, "local"))
    sendBtn.connect("clicked", () => run(sendBtn, "send"))

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update()
        return GLib.SOURCE_CONTINUE
    })
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, HEAL_S, () => {
        heal()
        return GLib.SOURCE_CONTINUE
    })

    update()

    // 3 equal expanding spacers -> identical gap at the left edge, between the
    // icons, and at the right edge. (halign:CENTER on a horizontal box is not
    // honored reliably in this AGS/GTK build, hence the manual spacers.)
    const spacer = () => new Gtk.Box({ hexpand: true })

    const row = new Gtk.Box({
        cssClasses: ["audio-route-row"],
        orientation: Gtk.Orientation.HORIZONTAL,
        hexpand: true,
    })
    row.append(spacer())
    row.append(localBtn)
    row.append(spacer())
    row.append(sendBtn)
    row.append(spacer())


    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        cssClasses: ["audio-route"],
        spacing: 6,
    })
    box.append(new Gtk.Box({ cssClasses: ["sidebar-separator"] }))
    box.append(row)
    return box
}
