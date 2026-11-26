import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

export interface MenuItem {
    label?: string
    child?: Gtk.Widget
    icon?: string
    onClick: () => void
    isDangerous?: boolean
}

export interface MenuSection {
    title?: string
    titleIcon?: string        // ícono a la izquierda del título
    titleGicon?: Gio.Icon     // o un ícono ya cargado (bandeja del sistema)
    titleExtra?: Gtk.Widget   // dato o botón a la derecha del título
    items?: MenuItem[]
    customChild?: Gtk.Widget
}

export function MenuPopover(
    parent: Gtk.Widget | null,
    sections: MenuSection[],
    position: Gtk.PositionType = Gtk.PositionType.BOTTOM
) {
    const popover = new Gtk.Popover({
        cssClasses: ["shared-popover"],
        hasArrow: false,
    })

    popover.set_position(position)

    // Forma "pegada al borde" desde el inicio: si se agregaba al mostrarse,
    // el primer cuadro salía sin ella y el menú saltaba al redibujarse
    // (por ejemplo, al pasar el mouse por encima)
    if (parent) {
        if (position === Gtk.PositionType.BOTTOM) popover.add_css_class("edge-top")
        else if (position === Gtk.PositionType.RIGHT) popover.add_css_class("edge-left")
    }

    const mainBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    })

    popover.set_child(mainBox)

    sections.forEach((section, idx) => {
        if (section.title) {
            // Encabezado: ícono · título ··· dato
            const head = new Gtk.Box({ spacing: 8, cssClasses: ["popover-header"] })
            if (section.titleIcon) head.append(new Gtk.Image({ iconName: section.titleIcon, cssClasses: ["popover-header-icon"] }))
            else if (section.titleGicon) head.append(new Gtk.Image({ gicon: section.titleGicon, cssClasses: ["popover-header-icon"] }))
            head.append(new Gtk.Label({ label: section.title, xalign: 0, hexpand: true, cssClasses: ["popover-header-title"] }))
            if (section.titleExtra) {
                section.titleExtra.add_css_class("popover-header-extra")
                section.titleExtra.set_valign(Gtk.Align.CENTER)
                head.append(section.titleExtra)
            }
            mainBox.append(head)
            mainBox.append(new Gtk.Separator({
                orientation: Gtk.Orientation.HORIZONTAL,
                cssClasses: ["popover-separator"]
            }))
        }

        if (section.items) {
            const sectionBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2
            })

            section.items.forEach(item => {
                const btn = new Gtk.Button({
                    cssClasses: ["popover-item"]
                })

                if (item.isDangerous)
                    btn.add_css_class("dangerous")

                const inner = new Gtk.Box({ spacing: 10 })

                if (item.icon)
                    inner.append(new Gtk.Image({ iconName: item.icon }))

                if (item.child) {
                    inner.append(item.child)
                } else {
                    inner.append(new Gtk.Label({
                        label: item.label ?? "",
                        xalign: 0,
                        hexpand: true
                    }))
                }

                btn.set_child(inner)
                btn.connect("clicked", () => {
                    item.onClick()
                    popover.popdown()
                })

                sectionBox.append(btn)
            })

            mainBox.append(sectionBox)
        } else if (section.customChild) {
            const oldParent = section.customChild.get_parent()
            if (oldParent && oldParent !== mainBox) {
                if (oldParent instanceof Gtk.Box) {
                    oldParent.remove(section.customChild)
                } else if ("set_child" in oldParent) {
                    (oldParent as any).set_child(null)
                }
            }
            section.customChild.add_css_class("popover-custom-content")
            mainBox.append(section.customChild)
        }

        if (idx < sections.length - 1) {
            mainBox.append(new Gtk.Separator({
                orientation: Gtk.Orientation.HORIZONTAL,
                cssClasses: ["popover-separator"]
            }))
        }
    })

    if (parent) {
        if ("set_popover" in parent) {
            (parent as any).set_popover(popover)
        } else {
            popover.set_parent(parent)
        }
        parent.connect("destroy", () => {
            if (popover.get_parent() === parent) {
                popover.set_parent(null!)
            }
        })
    }

    return popover
}