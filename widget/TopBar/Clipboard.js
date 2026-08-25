import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
import { MenuPopover } from "../Shared/MenuPopover";
export default function Clipboard() {
    const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE, cssClasses: ["clipboard-list"] });
    const rows = [];
    for (let i = 0; i < 10; i++) {
        const row = new Gtk.ListBoxRow({ visible: false });
        const btn = new Gtk.Button({ cssClasses: ["popover-item"] });
        const label = new Gtk.Label({ xalign: 0, ellipsize: 3, cssClasses: ["clip-item-label"] });
        btn.set_child(label);
        row.set_child(btn);
        list.append(row);
        rows.push({ row, btn, label });
    }
    const scrolled = new Gtk.ScrolledWindow({ vexpand: true });
    scrolled.set_size_request(250, 200);
    scrolled.set_child(list);
    const menubutton = new Gtk.MenuButton();
    menubutton.set_child(new Gtk.Image({ iconName: "edit-copy-symbolic" }));
    const popover = MenuPopover(menubutton, [
        {
            title: "Portapapeles",
            customChild: scrolled
        }
    ]);
    menubutton.set_popover(popover);
    const updateList = async () => {
        try {
            const output = await execAsync("cliphist list");
            const items = output.split("\n").filter(Boolean).slice(0, 10);
            rows.forEach((r, i) => {
                if (items[i]) {
                    const [id, ...textParts] = items[i].split("\t");
                    r.label.label = textParts.join("\t").substring(0, 60);
                    // Actualizar evento
                    r.btn.disconnect_by_func(r.btn.get_data("handler"));
                    const handler = r.btn.connect("clicked", () => {
                        execAsync(`bash -c 'echo "${id}" | cliphist decode | wl-copy'`);
                        popover.popdown();
                    });
                    r.btn.set_data("handler", handler);
                    r.row.visible = true;
                }
                else {
                    r.row.visible = false;
                }
            });
        }
        catch {
            rows.forEach((r, i) => {
                if (i === 0) {
                    r.label.label = "cliphist no disponible";
                    r.row.visible = true;
                }
                else {
                    r.row.visible = false;
                }
            });
        }
    };
    popover.connect("notify::visible", () => {
        if (popover.visible)
            updateList();
    });
    return menubutton;
}
