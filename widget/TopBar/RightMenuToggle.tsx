import { Gtk } from "ags/gtk4"

import { toggleRightMenu, onRightMenuVisible } from "../RightMenu"

// Botón que abre el menú derecho: píldora con el color del tema, al extremo
// derecho de la barra; rellena mientras el menú está abierto.
export default function RightMenuToggle() {
    const button = new Gtk.Button({
        cssClasses: ["rightmenu-toggle"],
        tooltipText: "Menú",
        valign: Gtk.Align.CENTER,
        child: new Gtk.Image({ iconName: "sidebar-show-right-symbolic" }),
    })
    button.connect("clicked", () => toggleRightMenu())
    onRightMenuVisible(open => open ? button.add_css_class("open") : button.remove_css_class("open"))
    return button
}
