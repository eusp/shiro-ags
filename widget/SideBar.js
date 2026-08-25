import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import app from "ags/gtk4/app";
import { Astal, Gtk } from "ags/gtk4";
import { MediaControls } from "./SideBar/MediaControls";
import { MediaVisualizer } from "./SideBar/MediaVisualizer";
import AppList from "./SideBar/AppList";
const { Gio } = imports.gi;
function launchDetached(command) {
    const app = Gio.Subprocess.new([command], Gio.SubprocessFlags.SEARCH_PATH | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    app.spawn(null);
}
export default function SideBar(gdkmonitor) {
    const { TOP, BOTTOM, LEFT } = Astal.WindowAnchor;
    return (_jsx(Astal.Window, { name: "sidebar", cssClasses: ["SideBar"], visible: true, gdkmonitor: gdkmonitor, exclusivity: Astal.Exclusivity.EXCLUSIVE, anchor: TOP | BOTTOM | LEFT, application: app, layer: Astal.Layer.TOP, children: _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["sidebar-container"], spacing: 10, children: [_jsx(AppList, {}), _jsx(MediaVisualizer, {}), _jsx("box", { orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.END, spacing: 8, cssClasses: ["system-zone"], children: _jsx(MediaControls, {}) })] }) }));
}
