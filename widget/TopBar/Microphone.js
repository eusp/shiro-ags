import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib";
import Wp from "../../lib/wp";
import { MenuPopover } from "../Shared/MenuPopover";
const wp = Wp.get_default();
export default function Microphone() {
    const getHasMic = () => {
        const mic = wp?.defaultMicrophone;
        return mic && mic.id !== 0;
    };
    const getMic = () => wp?.defaultMicrophone;
    const image = new Gtk.Image({
        iconName: "microphone-disabled-symbolic"
    });
    const menubutton = new Gtk.MenuButton({
        child: image,
        sensitive: false,
    });
    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 1,
        stepIncrement: 0.05,
        value: 0,
    });
    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        drawValue: false,
        hexpand: true,
        adjustment: adjustment,
    });
    slider.add_css_class("volume-slider");
    slider.connect("value-changed", () => {
        const mic = getMic();
        if (mic && Math.abs(mic.volume - adjustment.value) > 0.01) {
            mic.set_volume(adjustment.value);
        }
    });
    let lastId = 0;
    const update = () => {
        const has = getHasMic();
        const mic = getMic();
        image.iconName = has ? "audio-input-microphone-symbolic" : "microphone-disabled-symbolic";
        menubutton.sensitive = !!has;
        if (has && mic && Math.abs(adjustment.value - mic.volume) > 0.01) {
            adjustment.value = mic.volume;
        }
        const currentId = mic?.id ?? 0;
        if (currentId !== lastId) {
            lastId = currentId;
            if (mic) {
                mic.connect("notify::volume", update);
                mic.connect("notify::mute", update);
            }
        }
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update();
        return GLib.SOURCE_CONTINUE;
    });
    update();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
    });
    box.append(slider);
    const popover = MenuPopover(menubutton, [
        { title: "Micrófono", customChild: box }
    ]);
    menubutton.set_popover(popover);
    return menubutton;
}
