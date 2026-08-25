import { Gtk } from "ags/gtk4";
import { toggleRightMenu } from "../RightMenu";
export default function RightMenuToggle() {
    const icon = new Gtk.Image({ iconName: "view-more-symbolic" });
    const button = new Gtk.Button();
    button.set_child(icon);
    button.connect("clicked", () => {
        toggleRightMenu();
    });
    return button;
}
