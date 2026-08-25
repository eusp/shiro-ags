import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import ClockWeather from "./ClockWeather";
import InternetToggle from "./InternetToggle";
import BluetoothToggle from "./BluetoothToggle";
import SoundControl from "./SoundControl";
import MicrophoneControl from "./MicrophoneControl";
import BrightnessControl from "./BrightnessControl";
export function QuickSettingsList() {
    return (_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["quick-settings-list"], spacing: 4, children: [_jsx(InternetToggle, {}), _jsx(BluetoothToggle, {}), _jsx(SoundControl, {}), _jsx(MicrophoneControl, {}), _jsx(BrightnessControl, {})] }));
}
export default function QuickSettings() {
    return (_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["quick-settings"], spacing: 16, children: [_jsx(ClockWeather, {}), _jsx(QuickSettingsList, {})] }));
}
