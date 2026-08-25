import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import app from "ags/gtk4/app";
import { Astal, Gtk } from "ags/gtk4";
import Workspaces from "./TopBar/Workspaces";
import Clock from "./TopBar/Clock";
import Clipboard from "./TopBar/Clipboard";
import SystemMonitor from "./TopBar/SystemMonitor";
import Volume from "./TopBar/Volume";
import Microphone from "./TopBar/Microphone";
import BluetoothIndicator from "./TopBar/Bluetooth";
import NetworkIndicator from "./TopBar/Network";
import BatteryIndicator from "./TopBar/Battery";
import SysTray from "./TopBar/SysTray";
import RightMenuToggle from "./TopBar/RightMenuToggle";
import KeyboardLayout from "./TopBar/KeyboardLayout";
export default function TopBar(gdkmonitor) {
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;
    return (_jsx(Astal.Window, { name: "topbar", cssClasses: ["TopBar"], visible: true, gdkmonitor: gdkmonitor, exclusivity: Astal.Exclusivity.EXCLUSIVE, anchor: TOP | LEFT | RIGHT, application: app, layer: Astal.Layer.TOP, children: _jsxs("box", { cssClasses: ["bar-content"], children: [_jsx("box", { cssClasses: ["bar-left"], halign: Gtk.Align.START, hexpand: true, spacing: 8, children: _jsx(Workspaces, {}) }), _jsx("box", { cssClasses: ["bar-center"], halign: Gtk.Align.CENTER, hexpand: true, children: _jsx(Clock, {}) }), _jsxs("box", { cssClasses: ['bar-right'], halign: Gtk.Align.END, hexpand: true, spacing: 6, children: [_jsx(RightMenuToggle, {}), _jsx(KeyboardLayout, {}), _jsx(Clipboard, {}), _jsx(SystemMonitor, {}), _jsx(Volume, {}), _jsx(Microphone, {}), _jsx(BluetoothIndicator, {}), _jsx(NetworkIndicator, {}), _jsx(SysTray, {}), _jsx(BatteryIndicator, {})] })] }) }));
}
