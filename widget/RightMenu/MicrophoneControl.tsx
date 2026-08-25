import { Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Wp from "../../lib/wp"

const wp = Wp.get_default()

export default function MicrophoneControl() {
    const mic = wp?.defaultMicrophone
    if (!mic) return <box />

    const icon = new Gtk.Image({
        cssClasses: ["toggle-icon", "white-icon"]
    })

    const muteButton = new Gtk.Button({
        cssClasses: ["mute-button"],
        child: icon
    })

    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        draw_value: false,
        hexpand: true,
        cssClasses: ["toggle-slider"]
    })

    slider.set_range(0, 1)
    slider.connect("value-changed", () => {
        const val = slider.get_value()
        if (val > 0 && mic.mute) {
            mic.mute = false
        }
        mic.set_volume(val)
    })

    const update = () => {
        icon.icon_name = mic.mute ? "microphone-sensitivity-muted-symbolic" : "microphone-sensitivity-high-symbolic"
        slider.set_value(mic.mute ? 0 : mic.volume)
    }

    mic.connect("notify::volume", update)
    mic.connect("notify::mute", update)
    update()

    muteButton.connect("clicked", () => {
        mic.mute = !mic.mute
    })

    return (
        <box cssClasses={["quick-settings-item", "mic-control-item"]} spacing={12}>
            {muteButton}
            {slider}
            <button
                cssClasses={["arrow-button"]}
                onClicked={() => execAsync("pavucontrol").catch(() => { })}
            >
                <label label="" cssClasses={["toggle-arrow"]} />
            </button>
        </box>
    )
}
