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
            marginTop={40}
            marginRight={12}
            application={app}
            layer={Astal.Layer.OVERLAY}
        >
            {content}
        </Astal.Window>
    ) as Astal.Window

    let timeoutId: number | null = null

    // execAsync throws synchronously (not a rejected promise) when the
    // command itself doesn't exist — a bare .catch() chain never attaches
    // in that case, so a missing `canberra-play` was throwing straight out
    // of showPopup() and skipping `popupWindow.visible = true` entirely.
    const SOUND_CANDIDATES = [
        ["canberra-play", "-i", "message"],
        ["paplay", "/usr/share/sounds/freedesktop/stereo/message.oga"],
        ["play", "/usr/share/sounds/freedesktop/stereo/message.oga"],
    ]

    const playSound = (i = 0) => {
        if (i >= SOUND_CANDIDATES.length) return
        try {
            execAsync(SOUND_CANDIDATES[i]).catch(() => playSound(i + 1))
        } catch {
            playSound(i + 1)
        }
    }

    const showPopup = (n: any) => {
        // Update labels
        icon.icon_name = n.app_icon || "dialog-information-symbolic"
        summary.label = n.summary || ""
        body.label = n.body || ""

        playSound()

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
