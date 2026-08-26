import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gdk from "gi://Gdk?version=4.0";
import Notifd from "../../lib/notifd";
const notifd = Notifd.get_default();
function getWidgetExactCoords(widget) {
    const root = widget.get_root();
    if (!root)
        return { x: 0, y: 0, width: 0, height: 0 };
    const [success, x, y] = widget.translate_coordinates(root, 0, 0);
    return {
        x: success ? x : 0,
        y: success ? y : 0,
        width: widget.get_width(),
        height: widget.get_height(),
    };
}
// ═══════════════════════════════════════
// UTILIDADES DE NOTIFICACIONES
// ═══════════════════════════════════════
export const hasNotifications = () => notifd.get_notifications().length > 0;
export const notifCount = () => notifd.get_notifications().length;
export default function Clock() {
    // ═══════════════════════════════════════
    // CLOCKS
    // ═══════════════════════════════════════
    const barLabel = _jsx("label", { cssClasses: ["clock"] });
    const notifBadge = new Gtk.Label({
        cssClasses: ["clock-notif-badge"],
        visible: false,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        label: "",
    });
    const buttonContent = new Gtk.Box({
        spacing: 6,
        cssClasses: ["clock-button-content"],
        valign: Gtk.Align.CENTER,
    });
    buttonContent.append(barLabel);
    buttonContent.append(notifBadge);
    const popoverTimeLabel = _jsx("label", { cssClasses: ["popover-digital-time"] });
    const popoverDateLabel = _jsx("label", { cssClasses: ["popover-digital-date"] });
    const updateClocks = () => {
        const time = GLib.DateTime.new_now_local();
        barLabel.label = time.format("%H:%M  •  %a %d %b") || "";
        popoverTimeLabel.label = time.format("%H:%M:%S") || "";
        popoverDateLabel.label = time.format("%A, %d de %B de %Y") || "";
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        updateClocks();
        return GLib.SOURCE_CONTINUE;
    });
    updateClocks();
    // ═══════════════════════════════════════
    // NOTIFICATIONS (Reutilización de widgets)
    // ═══════════════════════════════════════
    const notifList = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
    const notifRows = [];
    for (let i = 0; i < 10; i++) {
        const item = new Gtk.Box({ spacing: 8, cssClasses: ["popover-notif-item"], visible: false });
        const icon = new Gtk.Image({ valign: Gtk.Align.CENTER });
        const textBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
        const summary = new Gtk.Label({ halign: Gtk.Align.START, cssClasses: ["popover-notif-summary"], ellipsize: 3, xalign: 0 });
        const body = new Gtk.Label({ halign: Gtk.Align.START, cssClasses: ["popover-notif-body"], ellipsize: 3, xalign: 0 });
        const dismissBtn = new Gtk.Button({
            cssClasses: ["popover-notif-dismiss"],
            valign: Gtk.Align.CENTER,
            child: new Gtk.Image({ iconName: "window-close-symbolic" }),
        });
        dismissBtn.connect("clicked", () => {
            const ns = notifd.get_notifications();
            const n = ns[i];
            if (n)
                n.dismiss();
        });
        textBox.append(summary);
        textBox.append(body);
        item.append(icon);
        item.append(textBox);
        item.append(dismissBtn);
        notifList.append(item);
        notifRows.push(item);
    }
    const updateNotifications = () => {
        const ns = notifd.get_notifications();
        const count = ns.length;
        // Badge con contador inline (a la derecha del reloj)
        notifBadge.label = count > 9 ? "9+" : String(count);
        notifBadge.visible = count > 0;
        notifRows.forEach((row, i) => {
            const n = ns[i];
            if (n) {
                const icon = row.get_first_child();
                const textBox = icon.get_next_sibling();
                const summary = textBox.get_first_child();
                const body = summary?.get_next_sibling();
                icon.icon_name = n.app_icon || "dialog-information-symbolic";
                summary.label = n.summary || "";
                body.label = n.body || "";
                row.visible = true;
            }
            else {
                row.visible = false;
            }
        });
    };
    notifd.connect("notified", updateNotifications);
    notifd.connect("resolved", updateNotifications);
    updateNotifications();
    // ═══════════════════════════════════════
    // POPUP UI
    // ═══════════════════════════════════════
    const calendar = new Gtk.Calendar({ cssClasses: ["popover-calendar"] });
    const popover = new Gtk.Popover({ cssClasses: ["clock-popover", "shared-popover"], hasArrow: false });
    popover.set_child(_jsxs("box", { spacing: 16, cssClasses: ["clock-popover-content"], children: [calendar, _jsx("box", { cssClasses: ["popover-vertical-separator"] }), _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 12, cssClasses: ["popover-clock-right"], children: [_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["popover-clock-zone"], children: [popoverTimeLabel, popoverDateLabel] }), _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 6, cssClasses: ["popover-notifs-zone"], vexpand: true, children: [_jsxs("box", { spacing: 8, cssClasses: ["popover-notifs-header"], children: [_jsx("label", { label: "Notificaciones", cssClasses: ["popover-notifs-title"], hexpand: true, halign: Gtk.Align.START }), _jsx("button", { cssClasses: ["popover-notifs-clear"], label: "Limpiar todo", onClicked: () => notifd.get_notifications().forEach(n => n.dismiss()) })] }), _jsx("scrolledwindow", { vexpand: true, heightRequest: 180, widthRequest: 300, cssClasses: ["popover-notifs-scrolled"], child: notifList })] })] })] }));
    const menuButton = new Gtk.MenuButton({ child: buttonContent, popover: popover });
    popover.connect("notify::visible", () => {
        if (!popover.visible)
            return;
        calendar.select_day(GLib.DateTime.new_now_local());
        updateNotifications();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            calendar.grab_focus();
            return GLib.SOURCE_REMOVE;
        });
        calendar.grab_focus();
        // Edge detection
        popover.remove_css_class("edge-top");
        popover.remove_css_class("edge-left");
        popover.remove_css_class("edge-right");
        const coords = getWidgetExactCoords(menuButton);
        const rect = new Gdk.Rectangle({ x: 0, y: 0, width: menuButton.get_width(), height: menuButton.get_height() });
        if (coords.y <= 45) {
            popover.add_css_class("edge-top");
            rect.y = 30 - coords.y;
            rect.height = 1;
        }
        if (coords.x <= 45) {
            popover.add_css_class("edge-left");
            rect.x = 30 - coords.x;
            rect.width = 1;
        }
        if (coords.x >= 1500)
            popover.add_css_class("edge-right");
        popover.set_pointing_to(rect);
    });
    return menuButton;
}
