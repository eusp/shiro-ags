import { Gtk } from "ags/gtk4";
import Tray from "../../lib/tray";
const tray = Tray.get_default();
export default function SysTray() {
    const list = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6
    });
    const update = () => {
        while (list.get_first_child()) {
            list.remove(list.get_first_child());
        }
        tray.items.forEach((item) => {
            const btn = new Gtk.MenuButton();
            btn.add_css_class("shortcut-btn");
            const img = new Gtk.Image({ gicon: item.gicon });
            btn.set_child(img);
            if (item.action_group) {
                btn.insert_action_group("dbusmenu", item.action_group);
            }
            if (item.menu_model) {
                btn.set_menu_model(item.menu_model);
            }
            const nativePopover = btn.get_popover();
            if (nativePopover) {
                nativePopover.add_css_class("systray-popover");
                nativePopover.add_css_class("shared-popover");
            }
            list.append(btn);
        });
    };
    tray.connect("notify::items", update);
    update();
    return list;
}
