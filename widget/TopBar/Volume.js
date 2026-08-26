import { Gtk } from "ags/gtk4";
import Wp from "../../lib/wp";
import { MenuPopover } from "../Shared/MenuPopover";
const wp = Wp.get_default();
export default function Volume() {
    const speaker = wp?.defaultSpeaker;
    if (!speaker)
        return new Gtk.Box();
    const icon = new Gtk.Image();
    const menubutton = new Gtk.MenuButton({ child: icon });
    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        drawValue: false,
        hexpand: true,
        adjustment: new Gtk.Adjustment({ lower: 0, upper: 1, stepIncrement: 0.05 })
    });
    slider.add_css_class("volume-slider");
    slider.connect("value-changed", () => {
        if (Math.abs(speaker.volume - slider.get_value()) > 0.01) {
            speaker.volume = slider.get_value();
        }
    });
    const popover = MenuPopover(menubutton, [
        {
            title: "Volumen",
            customChild: slider
        }
    ]);
    menubutton.set_popover(popover);
    const update = () => {
        icon.icon_name = speaker.volumeIcon;
        if (Math.abs(slider.get_value() - speaker.volume) > 0.01) {
            slider.set_value(speaker.volume);
        }
    };
    speaker.connect("notify::volume", update);
    speaker.connect("notify::mute", update);
    update();
    return menubutton;
}
