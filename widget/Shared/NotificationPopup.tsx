import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Notifd from "../../lib/notifd"
import GLib from "gi://GLib?version=2.0"
import { execAsync } from "ags/process"

const notifd = Notifd.get_default()

export default function NotificationPopup(gdkmonitor: Gdk.Monitor) {
    const { TOP, RIGHT } = Astal.WindowAnchor

    const icon = new Gtk.Image({ cssClasses: ["popup-notif-icon"], valign: Gtk.Align.CENTER })
    const summary = new Gtk.Label({ halign: Gtk.Align.START, cssClasses: ["popup-notif-summary"], ellipsize: 3, xalign: 0 })
    const body = new Gtk.Label({ halign: Gtk.Align.START, cssClasses: ["popup-notif-body"], ellipsize: 3, xalign: 0 })

    const textBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        hexpand: true,
        valign: Gtk.Align.CENTER
    })
    textBox.append(summary)
    textBox.append(body)

    const content = new Gtk.Box({
        spacing: 12,
        cssClasses: ["popup-notif-content"]
    })
    content.append(icon)
    content.append(textBox)

    const popupWindow = (
        <Astal.Window
            name="notification-popup"
            cssClasses={["NotificationPopup"]}
            visible={false}
            gdkmonitor={gdkmonitor}
            anchor={TOP | RIGHT}
            application={app}
            layer={Astal.Layer.OVERLAY}
        >
            {content}
        </Astal.Window>
    ) as Astal.Window

    let timeoutId: number | null = null

    const showPopup = (n: any) => {
        // Update labels
        icon.icon_name = n.app_icon || "dialog-information-symbolic"
        summary.label = n.summary || ""
        body.label = n.body || ""

        // Play sound
        execAsync("canberra-play -i message").catch(() => 
            execAsync("paplay /usr/share/sounds/freedesktop/stereo/message.oga").catch(() => 
                execAsync("play /usr/share/sounds/freedesktop/stereo/message.oga").catch(() => {})
            )
        )

        // Show window
        popupWindow.visible = true

        // Clear existing timeout
        if (timeoutId !== null) {
            GLib.source_remove(timeoutId)
        }

        // Hide after 5 seconds
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            popupWindow.visible = false
            timeoutId = null
            return GLib.SOURCE_REMOVE
        })
    }

    notifd.connect("notified", (self, id) => {
        const n = notifd.get_notification(id)
        if (n) {
            showPopup(n)
        }
    })

    return popupWindow
}
