import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Battery from "../../lib/battery"

const battery = Battery.get_default()

export default function BatteryAlertOverlay(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

    const icon = new Gtk.Image({ cssClasses: ["battery-alert-icon"] })
    const title = new Gtk.Label({ cssClasses: ["battery-alert-title"] })
    const subtitle = new Gtk.Label({
        cssClasses: ["battery-alert-subtitle"],
        wrap: true,
        maxWidthChars: 30,
        justify: Gtk.Justification.CENTER,
    })

    const closeBtn = new Gtk.Button({
        cssClasses: ["battery-alert-close"],
        halign: Gtk.Align.CENTER,
        child: new Gtk.Label({ label: "Cerrar" }),
    })

    // This is the window's direct child — the dim scrim itself lives on
    // the window's own CSS node (see below), not on this box, since a
    // nested Box never actually got allocated the full monitor size here
    // (its own background stayed a small top-left patch no matter what
    // expand/align/size-request combination it was given) while the
    // *window's* background reliably painted the whole layer-shell
    // surface. Centering the card directly against the window's content
    // area sidesteps that entirely.
    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        cssClasses: ["battery-alert-card"],
    })
    card.append(icon)
    card.append(title)
    card.append(subtitle)
    card.append(closeBtn)

    const { width: monWidth, height: monHeight } = gdkmonitor.get_geometry()

    const overlayWindow = (
        <Astal.Window
            name="battery-alert-overlay"
            cssClasses={["BatteryAlertOverlay"]}
            visible={false}
            gdkmonitor={gdkmonitor}
            anchor={TOP | BOTTOM | LEFT | RIGHT}
            exclusivity={Astal.Exclusivity.IGNORE}
            keymode={Astal.Keymode.ON_DEMAND}
            application={app}
            layer={Astal.Layer.OVERLAY}
        >
            {card}
        </Astal.Window>
    ) as Astal.Window

    overlayWindow.set_default_size(monWidth, monHeight)

    closeBtn.connect("clicked", () => {
        overlayWindow.visible = false
    })

    battery.connect("low-battery", (_self: any, pct: number, critical: boolean) => {
        icon.iconName = critical ? "battery-caution-symbolic" : "battery-low-symbolic"
        if (critical) card.add_css_class("critical")
        else card.remove_css_class("critical")

        title.label = critical ? `Batería crítica: ${pct}%` : `Batería baja: ${pct}%`
        subtitle.label = critical
            ? "Conectá el cargador ya — se puede apagar en cualquier momento."
            : "Conectá el cargador pronto."

        overlayWindow.visible = true
    })

    return overlayWindow
}
