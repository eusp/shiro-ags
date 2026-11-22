import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Wp from "../../lib/wp"
import { MenuPopover } from "../Shared/MenuPopover"

const wp = Wp.get_default()

interface Sink { name: string; description: string }

// Nombre corto para la lista de salidas
function sinkLabel(s: Sink): { label: string; icon: string } {
    const d = s.description
    if (/hdmi|displayport/i.test(d + s.name)) return { label: "HDMI / monitor", icon: "video-display-symbolic" }
    if (/bluez|bluetooth/i.test(s.name)) return { label: d, icon: "audio-headphones-symbolic" }
    if (/usb/i.test(s.name)) return { label: d.replace(/ Analog Stereo$/, ""), icon: "audio-headset-symbolic" }
    if (/analog/i.test(d)) return { label: "Altavoces / auriculares", icon: "audio-speakers-symbolic" }
    return { label: d, icon: "audio-speakers-symbolic" }
}

export default function Volume() {
    const speaker = wp?.defaultSpeaker
    if (!speaker) return new Gtk.Box()

    const icon = new Gtk.Image()
    const menubutton = new Gtk.MenuButton({ child: icon })

    // ── Encabezado: porcentaje a la derecha ──
    const percent = new Gtk.Label({ label: "" })

    // ── Silencio + slider ──
    const muteIcon = new Gtk.Image()
    const muteBtn = new Gtk.Button({ cssClasses: ["popover-icon-btn", "volume-mute"], child: muteIcon, valign: Gtk.Align.CENTER })
    muteBtn.connect("clicked", () => { speaker.mute = !speaker.mute })

    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        drawValue: false,
        hexpand: true,
        adjustment: new Gtk.Adjustment({ lower: 0, upper: 1, stepIncrement: 0.05 })
    })
    slider.add_css_class("volume-slider")
    slider.connect("value-changed", () => {
        if (Math.abs(speaker.volume - slider.get_value()) > 0.01) {
            speaker.volume = slider.get_value()
        }
    })

    const sliderRow = new Gtk.Box({ spacing: 6, cssClasses: ["volume-row"] })
    sliderRow.append(muteBtn)
    sliderRow.append(slider)

    // ── Salidas de audio ──
    const outputsTitle = new Gtk.Label({ label: "Salida", xalign: 0, cssClasses: ["popover-section-title"] })
    const outputsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    const outputs = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    outputs.append(outputsTitle)
    outputs.append(outputsBox)

    const loadOutputs = async () => {
        let sinks: Sink[] = []
        let current = ""
        try {
            sinks = JSON.parse(await execAsync(["pactl", "-f", "json", "list", "sinks"]))
            current = (await execAsync(["pactl", "get-default-sink"])).trim()
        } catch (e) {
            logError(e as Error, "volume: pactl failed")
        }
        while (outputsBox.get_first_child()) outputsBox.remove(outputsBox.get_first_child()!)
        outputs.visible = sinks.length > 1
        for (const s of sinks) {
            const { label, icon } = sinkLabel(s)
            const active = s.name === current
            const row = new Gtk.Box({ spacing: 10 })
            row.append(new Gtk.Image({ iconName: icon }))
            row.append(new Gtk.Label({ label, xalign: 0, hexpand: true, ellipsize: 3, maxWidthChars: 26, tooltipText: s.description }))
            row.append(new Gtk.Image({ iconName: "object-select-symbolic", cssClasses: ["popover-check"], opacity: active ? 1 : 0 }))
            const btn = new Gtk.Button({ cssClasses: ["popover-item", ...(active ? ["active"] : [])], child: row })
            btn.connect("clicked", () => {
                execAsync(["pactl", "set-default-sink", s.name]).then(loadOutputs).catch(e => logError(e, "volume: set sink failed"))
            })
            outputsBox.append(btn)
        }
    }

    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
    body.append(sliderRow)
    body.append(outputs)

    const popover = MenuPopover(menubutton, [
        { title: "Volumen", titleIcon: "audio-volume-high-symbolic", titleExtra: percent, customChild: body },
    ])
    menubutton.set_popover(popover)
    popover.connect("notify::visible", () => { if (popover.visible) loadOutputs() })

    const update = () => {
        icon.icon_name = speaker.volumeIcon
        muteIcon.icon_name = speaker.mute ? "audio-volume-muted-symbolic" : "audio-volume-high-symbolic"
        muteBtn.tooltipText = speaker.mute ? "Quitar silencio" : "Silenciar"
        speaker.mute ? muteBtn.add_css_class("muted") : muteBtn.remove_css_class("muted")
        percent.label = speaker.mute ? "silencio" : `${Math.round(speaker.volume * 100)}%`
        menubutton.tooltipText = `Volumen: ${percent.label}`

        if (Math.abs(slider.get_value() - speaker.volume) > 0.01) {
            slider.set_value(speaker.volume)
        }
    }

    speaker.connect("notify::volume", update)
    speaker.connect("notify::mute", update)

    update()

    popover.add_css_class("topbar-menu")  // mismo ancho que los demás menús de la barra
    return menubutton
}
