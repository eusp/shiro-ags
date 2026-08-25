import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
export default function NotificationPanel() {
    const openNotificationCenter = () => {
        execAsync("gnome-control-center notifications").catch(() => { });
    };
    const clearNotifications = () => {
        execAsync("notify-send 'Notificaciones' 'Todas las notificaciones han sido limpiadas'").catch(() => { });
    };
    return (_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["notification-panel"], spacing: 8, children: [_jsxs("box", { orientation: Gtk.Orientation.HORIZONTAL, cssClasses: ["notification-header"], spacing: 8, children: [_jsx("label", { cssClasses: ["section-title"], label: "Notificaciones", halign: Gtk.Align.START, hexpand: true }), _jsx("button", { cssClasses: ["clear-button"], label: "Limpiar", onClicked: clearNotifications })] }), _jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["notification-list"], spacing: 4, heightRequest: 120, children: _jsx("label", { cssClasses: ["empty-state"], label: "No hay notificaciones recientes", halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER, vexpand: true }) })] }));
}
