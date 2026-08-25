import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
export default function MusicControl() {
    const openMusicPlayer = () => {
        execAsync("spotify").catch(() => {
            execAsync("rhythmbox").catch(() => { });
        });
    };
    return (_jsx("button", { cssClasses: ["quick-toggle", "music-toggle"], onClicked: openMusicPlayer, hexpand: true, children: _jsxs("box", { orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, halign: Gtk.Align.FILL, children: [_jsxs("box", { spacing: 12, hexpand: true, children: [_jsx("label", { cssClasses: ["toggle-icon"], label: "\uDB80\uDF88" }), _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, children: [_jsx("label", { cssClasses: ["toggle-title"], label: "Multimedia", halign: Gtk.Align.START }), _jsx("label", { cssClasses: ["toggle-label"], label: "Abrir reproductor", halign: Gtk.Align.START })] })] }), _jsx("label", { label: "\uF105", cssClasses: ["toggle-arrow"] })] }) }));
}
