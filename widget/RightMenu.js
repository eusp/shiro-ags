import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import app from "ags/gtk4/app";
import { Astal, Gtk } from "ags/gtk4";
import ClockWeather from "./RightMenu/ClockWeather";
import { QuickSettingsList } from "./RightMenu/QuickSettings";
import AppsPanel from "./RightMenu/AppsPanel";
import PowerActions from "./RightMenu/PowerActions";
import ThemeSelector, { themeExpanded } from "./RightMenu/ThemeSelector";
const { GLib } = imports.gi;
let rightMenuWindowRef = null;
let appsPanelRef = null;
export function toggleRightMenu() {
    if (!rightMenuWindowRef)
        return;
    if (rightMenuWindowRef.visible) {
        rightMenuWindowRef.hide();
    }
    else {
        rightMenuWindowRef.show();
    }
}
export default function RightMenu(gdkmonitor) {
    const { TOP, BOTTOM, RIGHT } = Astal.WindowAnchor;
    const appsPanel = _jsx(AppsPanel, {});
    appsPanelRef = appsPanel;
    const settingsList = (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["quick-settings-zone"], children: _jsx(QuickSettingsList, {}) }));
    // Hide only the toggles list when theme selector is open
    themeExpanded.subscribe(expanded => {
        settingsList.set_visible(!expanded);
    });
    const rightMenuWindow = (_jsx(Astal.Window, { name: "rightmenu", cssClasses: ["RightMenu"], visible: false, gdkmonitor: gdkmonitor, exclusivity: Astal.Exclusivity.EXCLUSIVE, anchor: TOP | BOTTOM | RIGHT, application: app, layer: Astal.Layer.TOP, keymode: Astal.Keymode.ON_DEMAND, onShow: () => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                if (appsPanelRef && appsPanelRef.searchEntry) {
                    appsPanelRef.searchEntry.grab_focus();
                }
                return false;
            });
        }, children: _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rightmenu-container"], spacing: 12, widthRequest: 320, children: [_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["quick-settings"], spacing: 16, children: [_jsx(ClockWeather, {}), settingsList] }), _jsx(ThemeSelector, {}), _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["menu-bottom-zone"], spacing: 0, vexpand: true, valign: Gtk.Align.END, children: [_jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-panel-zone"], children: appsPanel }), _jsx("box", { orientation: Gtk.Orientation.HORIZONTAL, cssClasses: ["power-actions-zone"], hexpand: true, halign: Gtk.Align.END, children: _jsx(PowerActions, {}) })] })] }) }));
    rightMenuWindowRef = rightMenuWindow;
    return rightMenuWindow;
}
