import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import Apps from "gi://AstalApps";
const apps = new Apps.Apps();
export default function AppsDock() {
    const list = (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 6, marginTop: 10, marginBottom: 10 }));
    const update = () => {
        // Regla 5: Limpiar hijos
        while (list.get_first_child()) {
            list.remove(list.get_first_child());
        }
        apps.list
            .filter((app) => app.is_favorite)
            .forEach((app) => {
            list.append(_jsx("button", { cssClasses: ["dock-button"], tooltipText: app.name, onClicked: () => app.launch(), children: _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 4, halign: Gtk.Align.CENTER, children: [_jsx("image", { iconName: app.icon_name ??
                                "application-x-executable-symbolic", pixelSize: 28 }), app.running && (_jsx("box", { cssClasses: ["running-indicator"], widthRequest: 6, heightRequest: 6, halign: Gtk.Align.CENTER }))] }) }));
        });
    };
    // AstalApps signals
    apps.connect("notify::list", update);
    update();
    return (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-dock"], spacing: 8, vexpand: true, children: _jsx(Gtk.ScrolledWindow, { vexpand: true, children: list }) }));
}
