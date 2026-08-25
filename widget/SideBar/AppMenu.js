import { Gtk } from "ags/gtk4";
import Apps from "gi://AstalApps";
const apps = new Apps.Apps();
export default function AppMenu() {
    // Contenedor de la lista de apps
    const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
    const update = (search) => {
        // Limpiar hijos (Regla 5)
        while (list.get_first_child()) {
            list.remove(list.get_first_child());
        }
        const appsList = !search ? apps.list : apps.fuzzy_query(search);
        appsList.forEach((app) => {
            const innerBox = new Gtk.Box({ spacing: 10 });
            const icon = new Gtk.Image({
                iconName: app.icon_name ?? "application-x-executable-symbolic",
            });
            const label = new Gtk.Label({ label: app.name ?? "App", xalign: 0 });
            innerBox.append(icon);
            innerBox.append(label);
            const button = new Gtk.Button();
            button.set_child(innerBox);
            button.connect("clicked", () => {
                app.launch();
            });
            list.append(button);
        });
    };
    // Población inicial
    update("");
    // Construir menú principal
    const menubutton = new Gtk.MenuButton({ tooltipText: "Aplicaciones" });
    menubutton.set_child(new Gtk.Image({ iconName: "view-app-grid-symbolic" }));
    // Popover
    const popover = new Gtk.Popover();
    menubutton.set_popover(popover);
    const popoverBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, marginTop: 12, marginBottom: 12, marginStart: 16, marginEnd: 16 });
    popover.set_child(popoverBox);
    // Entry de búsqueda
    const entry = new Gtk.Entry({ placeholderText: "Buscar aplicaciones..." });
    entry.connect("changed", () => update(entry.text));
    popoverBox.append(entry);
    // ScrolledWindow
    const scrolled = new Gtk.ScrolledWindow({ vexpand: true });
    scrolled.set_size_request(300, 400);
    scrolled.set_child(list);
    popoverBox.append(scrolled);
    return menubutton;
}
