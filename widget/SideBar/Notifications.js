import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import Notifd from "gi://AstalNotifd";
import Pango from "gi://Pango";
const notifd = Notifd.get_default();
export default function Notifications() {
    const badgeLabel = (_jsx("label", { cssClasses: ["notif-badge"] }));
    const list = (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 4 }));
    const update = () => {
        const ns = notifd.get_notifications();
        // Badge
        badgeLabel.label =
            ns.length > 0
                ? String(ns.length)
                : "";
        badgeLabel.set_visible(ns.length > 0);
        // Clear current list
        while (list.get_first_child()) {
            list.remove(list.get_first_child());
        }
        // Rebuild notifications
        ns.forEach((n) => {
            list.append(_jsxs("box", { spacing: 8, cssClasses: ["notif-item"], children: [_jsx("image", { iconName: n.app_icon ||
                            "dialog-information-symbolic" }), _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, hexpand: true, children: [_jsx("label", { label: n.summary || "Notificación", ellipsize: Pango.EllipsizeMode.END, maxWidthChars: 32, wrap: false, hexpand: true, halign: Gtk.Align.START, cssClasses: ["notif-summary"] }), _jsx("label", { label: n.body || "", ellipsize: Pango.EllipsizeMode.END, maxWidthChars: 40, wrap: false, hexpand: true, halign: Gtk.Align.START, cssClasses: ["notif-body"] })] })] }));
        });
    };
    // Signals
    notifd.connect("notified", update);
    notifd.connect("resolved", update);
    update();
    return (_jsxs("menubutton", { cssClasses: ["notif-btn"], children: [_jsxs("box", { spacing: 4, children: [_jsx("image", { iconName: "notifications-symbolic" }), badgeLabel] }), _jsx("popover", { children: _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 8, cssClasses: ["notif-panel"], children: [_jsxs("box", { spacing: 20, children: [_jsx("label", { label: "Notificaciones", cssClasses: ["notif-title"], hexpand: true, halign: Gtk.Align.START }), _jsx("button", { onClicked: () => notifd
                                        .get_notifications()
                                        .forEach((n) => n.dismiss()), children: _jsx("label", { label: "Limpiar todo" }) })] }), _jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["divider"] }), _jsx(Gtk.ScrolledWindow, { heightRequest: 300, vexpand: true, children: list })] }) })] }));
}
