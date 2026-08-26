import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
import Wp from "../../lib/wp";
const wp = Wp.get_default();
export default function SoundControl() {
    const speaker = wp?.defaultSpeaker;
    if (!speaker)
        return _jsx("box", {});
    const icon = new Gtk.Image({
        cssClasses: ["toggle-icon", "white-icon"]
    });
    const muteButton = new Gtk.Button({
        cssClasses: ["mute-button"],
        child: icon
    });
    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        draw_value: false,
        hexpand: true,
        cssClasses: ["toggle-slider"]
    });
    slider.set_range(0, 1);
    slider.connect("value-changed", () => {
        const val = slider.get_value();
        if (val > 0 && speaker.mute) {
            speaker.mute = false;
        }
        speaker.set_volume(val);
    });
    const update = () => {
        icon.icon_name = speaker.mute ? "audio-volume-muted-symbolic" : (speaker.volumeIcon || "audio-volume-high-symbolic");
        slider.set_value(speaker.mute ? 0 : speaker.volume);
    };
    speaker.connect("notify::volume", update);
    speaker.connect("notify::mute", update);
    update();
    muteButton.connect("clicked", () => {
        speaker.mute = !speaker.mute;
    });
    return (_jsxs("box", { cssClasses: ["quick-settings-item", "sound-control-item"], spacing: 12, children: [muteButton, slider, _jsx("button", { cssClasses: ["arrow-button"], onClicked: () => execAsync("pavucontrol").catch(() => { }), children: _jsx("label", { label: "\uF105", cssClasses: ["toggle-arrow"] }) })] }));
}
