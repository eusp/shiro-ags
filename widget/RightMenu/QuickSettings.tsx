import { Gtk } from "ags/gtk4"
import ClockWeather from "./ClockWeather"
import InternetToggle from "./InternetToggle"
import BluetoothToggle from "./BluetoothToggle"
import SoundControl from "./SoundControl"
import MicrophoneControl from "./MicrophoneControl"
import BrightnessControl from "./BrightnessControl"

export function QuickSettingsList() {
    return (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["quick-settings-list"]}
            spacing={4}
        >
            <InternetToggle />
            <BluetoothToggle />
            <SoundControl />
            <MicrophoneControl />
            <BrightnessControl />
        </box>
    )
}

export default function QuickSettings() {
    return (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["quick-settings"]}
            spacing={16}
        >
            <ClockWeather />
            <QuickSettingsList />
        </box>
    )
}
