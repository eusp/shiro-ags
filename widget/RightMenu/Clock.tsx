import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib?version=2.0"

// Reloj del menú derecho: hora grande con segundos discretos y fecha.

export default function Clock() {
    const timeLabel = new Gtk.Label({ cssClasses: ["clock-time"], valign: Gtk.Align.BASELINE_FILL })
    const secondsLabel = new Gtk.Label({ cssClasses: ["clock-seconds"], valign: Gtk.Align.BASELINE_FILL })
    const dateLabel = new Gtk.Label({ cssClasses: ["clock-date"], halign: Gtk.Align.CENTER })

    const timeRow = new Gtk.Box({ halign: Gtk.Align.CENTER, spacing: 4 })
    timeRow.append(timeLabel)
    timeRow.append(secondsLabel)

    const update = () => {
        const now = GLib.DateTime.new_now_local()
        timeLabel.label = now.format("%H:%M") ?? ""
        secondsLabel.label = now.format("%S") ?? ""
        dateLabel.label = now.format("%A · %d de %B") ?? ""
    }
    update()
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        update()
        return GLib.SOURCE_CONTINUE
    })

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["clock-container"] })
    box.append(timeRow)
    box.append(dateLabel)
    return box
}
