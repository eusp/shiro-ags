import { Gtk } from "ags/gtk4";
export function MenuPopover(parent, sections, position = Gtk.PositionType.BOTTOM) {
    const popover = new Gtk.Popover({
        cssClasses: ["shared-popover"],
        hasArrow: false,
    });
    popover.set_position(position);
    popover.connect("notify::visible", () => {
        if (!popover.visible || !parent)
            return;
        const currentPosition = popover.get_position();
        if (currentPosition === Gtk.PositionType.BOTTOM) {
            popover.add_css_class("edge-top");
        }
        else if (currentPosition === Gtk.PositionType.RIGHT) {
            popover.add_css_class("edge-left");
        }
    });
    const mainBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    });
    popover.set_child(mainBox);
    sections.forEach((section, idx) => {
        if (section.title) {
            mainBox.append(new Gtk.Label({
                label: section.title,
                xalign: 0.5,
                cssClasses: ["popover-section-title"]
            }));
            mainBox.append(new Gtk.Separator({
                orientation: Gtk.Orientation.HORIZONTAL,
                cssClasses: ["popover-separator"]
            }));
        }
        if (section.items) {
            const sectionBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2
            });
            section.items.forEach(item => {
                const btn = new Gtk.Button({
                    cssClasses: ["popover-item"]
                });
                if (item.isDangerous)
                    btn.add_css_class("dangerous");
                const inner = new Gtk.Box({ spacing: 10 });
                if (item.icon)
                    inner.append(new Gtk.Image({ iconName: item.icon }));
                if (item.child) {
                    inner.append(item.child);
                }
                else {
                    inner.append(new Gtk.Label({
                        label: item.label ?? "",
                        xalign: 0,
                        hexpand: true
                    }));
                }
                btn.set_child(inner);
                btn.connect("clicked", () => {
                    item.onClick();
                    popover.popdown();
                });
                sectionBox.append(btn);
            });
            mainBox.append(sectionBox);
        }
        else if (section.customChild) {
            const oldParent = section.customChild.get_parent();
            if (oldParent && oldParent !== mainBox) {
                if (oldParent instanceof Gtk.Box) {
                    oldParent.remove(section.customChild);
                }
                else if ("set_child" in oldParent) {
                    oldParent.set_child(null);
                }
            }
            section.customChild.add_css_class("popover-custom-content");
            mainBox.append(section.customChild);
        }
        if (idx < sections.length - 1) {
            mainBox.append(new Gtk.Separator({
                orientation: Gtk.Orientation.HORIZONTAL,
                cssClasses: ["popover-separator"]
            }));
        }
    });
    if (parent) {
        if ("set_popover" in parent) {
            parent.set_popover(popover);
        }
        else {
            popover.set_parent(parent);
        }
        parent.connect("destroy", () => {
            if (!popover.is_finalized && popover.get_parent() === parent) {
                popover.set_parent(null);
            }
        });
    }
    return popover;
}
