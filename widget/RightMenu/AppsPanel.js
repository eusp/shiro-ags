import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
import Hyprland from "gi://AstalHyprland";
import Apps from "gi://AstalApps";
import { MenuPopover } from "../Shared/MenuPopover";
import pins from "../../lib/pins";
const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const hyprland = Hyprland.get_default();
const apps = new Apps.Apps();
function launchDetached(command) {
    const { Gio } = imports.gi;
    try {
        new Gio.Subprocess({
            argv: [command],
        }).init(null);
    }
    catch (e) {
        // @ts-ignore
        if (typeof print !== 'undefined')
            print(e);
    }
}
function tryGetAppInfo(id) {
    if (!id)
        return null;
    // @ts-ignore
    const DesktopAppInfo = (imports.gi.GioUnix ? imports.gi.GioUnix.DesktopAppInfo : Gio.DesktopAppInfo);
    const di = DesktopAppInfo.new(id) ||
        DesktopAppInfo.new(id + ".desktop") ||
        DesktopAppInfo.new("org.mozilla." + id) ||
        DesktopAppInfo.new("org.gnome." + (id === "nautilus" ? "Nautilus" : id));
    return di;
}
function createContextMenu(widget, appInfo) {
    const sections = [];
    const appId = appInfo.get_id ? appInfo.get_id() : "";
    const desktopAppInfo = tryGetAppInfo(appId);
    // 1. Desktop Actions (Jump Lists)
    if (desktopAppInfo) {
        // @ts-ignore
        const actions = desktopAppInfo.list_actions ? desktopAppInfo.list_actions() : [];
        if (actions.length > 0) {
            sections.push({
                title: desktopAppInfo.get_display_name(),
                items: actions.map((name) => ({
                    label: desktopAppInfo.get_action_name(name) || name,
                    icon: "system-run-symbolic",
                    onClick: () => {
                        // @ts-ignore
                        if (desktopAppInfo.launch_action)
                            desktopAppInfo.launch_action(name, null);
                    }
                }))
            });
        }
    }
    // 2. Pinning Options
    const pinningItems = [];
    const isPinnedMenu = pins.isPinnedMenu(appId);
    const isPinnedSidebar = pins.isPinnedSidebar(appId);
    pinningItems.push({
        label: isPinnedMenu ? "Desanclar del menú" : "Anclar al menú",
        icon: isPinnedMenu ? "bookmark-remove-symbolic" : "bookmark-new-symbolic",
        onClick: () => pins.toggleMenu(appId)
    });
    pinningItems.push({
        label: isPinnedSidebar ? "Desanclar del sidebar" : "Anclar al sidebar",
        icon: isPinnedSidebar ? "pin-symbolic" : "bookmark-new-symbolic",
        onClick: () => pins.toggleSidebar(appId)
    });
    sections.push({ items: pinningItems });
    // 3. Window Management
    const desktopApp = apps.list.find((a) => a.id === appId);
    const match = desktopApp?.wm_class?.toLowerCase() || desktopApp?.name?.toLowerCase() || appId.split(".")[0];
    const client = hyprland.clients.find((c) => (c.class?.toLowerCase() || "").includes(match));
    const windowItems = [];
    windowItems.push({
        label: "Nueva ventana",
        icon: "window-new-symbolic",
        onClick: () => {
            const cmd = appInfo.get_executable ? appInfo.get_executable() : null;
            if (cmd)
                launchDetached(cmd);
        }
    });
    if (client) {
        const addr = client.address.startsWith("0x") ? client.address : `0x${client.address}`;
        windowItems.push({
            label: "Minimizar",
            icon: "window-minimize-symbolic",
            onClick: () => hyprland.dispatch("movetoworkspacesilent", `special:minimized,address:${addr}`)
        });
        windowItems.push({
            label: "Flotante",
            icon: "window-pop-out-symbolic",
            onClick: () => hyprland.dispatch("togglefloating", `address:${addr}`)
        });
        windowItems.push({
            label: "Cerrar",
            icon: "window-close-symbolic",
            onClick: () => hyprland.dispatch("closewindow", `address:${addr}`),
            isDangerous: true
        });
    }
    sections.push({ items: windowItems });
    return MenuPopover(widget, sections, Gtk.PositionType.LEFT);
}
export default function AppsPanel() {
    const allInstalledApps = (Gio.AppInfo.get_all() || [])
        .filter((a) => a && a.should_show && a.should_show());
    const findById = (id) => allInstalledApps.find((a) => a.get_id && a.get_id() === id);
    const getDisplayName = (appInfo) => (appInfo.get_display_name && appInfo.get_display_name())
        || (appInfo.get_name && appInfo.get_name())
        || "App";
    const launchApp = (appInfo) => {
        try {
            appInfo.launch([], null);
        }
        catch {
            const cmd = appInfo.get_executable ? appInfo.get_executable() : null;
            if (cmd)
                execAsync(cmd).catch(() => { });
        }
    };
    // ── Helper: crea un FlowBox con configuración idéntica ──────────────────
    const createAppFlow = (extraClasses = []) => new Gtk.FlowBox({
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 8,
        rowSpacing: 8,
        homogeneous: true,
        minChildrenPerLine: 4,
        maxChildrenPerLine: 4,
        hexpand: true,
        vexpand: false,
        cssClasses: ["apps-grid", ...extraClasses],
    });
    const createAppTile = (appInfo, cssClasses = ["app-tile"]) => {
        const displayName = getDisplayName(appInfo);
        const iconObj = appInfo.get_icon ? appInfo.get_icon() : null;
        const btn = new Gtk.Button({ cssClasses });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        const icon = new Gtk.Image({ pixelSize: 32 });
        if (iconObj)
            icon.set_from_gicon(iconObj);
        const name = new Gtk.Label({
            label: displayName,
            cssClasses: ["app-tile-name"],
            ellipsize: 3,
            maxWidthChars: 10,
            justify: Gtk.Justification.CENTER,
            halign: Gtk.Align.CENTER,
        });
        box.append(icon);
        box.append(name);
        btn.set_child(box);
        btn.connect("clicked", () => launchApp(appInfo));
        // Context Menu (Lazy Loaded)
        let popover = null;
        const gesture = new Gtk.GestureClick({ button: 3 });
        gesture.connect("released", () => {
            if (!popover) {
                popover = createContextMenu(btn, appInfo);
            }
            popover.popup();
        });
        btn.add_controller(gesture);
        return btn;
    };
    const root = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        cssClasses: ["apps-panel"],
    });
    const searchEntry = new Gtk.Entry({
        placeholderText: "Buscar aplicaciones...",
        cssClasses: ["app-search"],
        hexpand: true,
    });
    // ── FlowBoxes con configuración unificada ────────────────────────────────
    const flow = createAppFlow();
    const pinnedFlow = createAppFlow(["pinned-grid"]);
    const noResultsLabel = new Gtk.Label({
        label: "No se encontraron aplicaciones",
        cssClasses: ["no-results-label"],
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        visible: false,
    });
    const scrolled = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: false, // ← quitar el vexpand
    });
    scrolled.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
    scrolled.set_child(flow);
    scrolled.set_min_content_height(225);
    scrolled.set_max_content_height(225);
    scrolled.set_propagate_natural_height(true);
    const pinnedSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        cssClasses: ["pinned-section"],
    });
    pinnedSection.append(new Gtk.Label({
        halign: Gtk.Align.START,
        cssClasses: ["apps-section-title"],
    }));
    pinnedSection.append(pinnedFlow);
    const updatePinned = () => {
        while (pinnedFlow.get_first_child()) {
            pinnedFlow.remove(pinnedFlow.get_first_child());
        }
        const currentPins = pins.getMenu();
        currentPins.forEach(id => {
            const app = findById(id);
            if (app)
                pinnedFlow.insert(createAppTile(app, ["app-tile", "pinned-tile"]), -1);
        });
        pinnedSection.visible = currentPins.length > 0;
    };
    pins.connect("menu-changed", updatePinned);
    updatePinned();
    let firstHighlightedApp = null;
    const render = () => {
        const q = searchEntry.get_text().trim().toLowerCase();
        while (flow.get_first_child())
            flow.remove(flow.get_first_child());
        firstHighlightedApp = null;
        if (q.length === 0) {
            scrolled.visible = false;
            noResultsLabel.visible = false;
            pinnedSection.visible = pins.getMenu().length > 0;
            return;
        }
        scrolled.visible = true;
        pinnedSection.visible = false;
        const filtered = allInstalledApps
            .filter((a) => {
            const name = getDisplayName(a);
            return name.toLowerCase().includes(q);
        })
            .slice(0, 60);
        if (filtered.length === 0) {
            scrolled.visible = false;
            noResultsLabel.visible = true;
            return;
        }
        noResultsLabel.visible = false;
        filtered.forEach((app, index) => {
            if (index === 0) {
                firstHighlightedApp = app;
                flow.append(createAppTile(app, ["app-tile", "highlighted"]));
            }
            else {
                flow.append(createAppTile(app));
            }
        });
    };
    searchEntry.connect("activate", () => {
        if (firstHighlightedApp)
            launchApp(firstHighlightedApp);
    });
    searchEntry.connect("changed", render);
    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        cssClasses: ["search-box"],
    });
    searchBox.append(searchEntry);
    const menuButton = new Gtk.Button({
        cssClasses: ["menu-button"],
        child: new Gtk.Image({ iconName: "view-grid-symbolic" })
    });
    let isShowingAll = false;
    menuButton.connect("clicked", () => {
        if (isShowingAll) {
            isShowingAll = false;
            searchEntry.set_text("");
            render();
        }
        else {
            isShowingAll = true;
            while (flow.get_first_child())
                flow.remove(flow.get_first_child());
            allInstalledApps.slice(0, 60).forEach((a) => flow.append(createAppTile(a)));
            scrolled.visible = true;
            pinnedSection.visible = false;
        }
    });
    searchBox.append(menuButton);
    root.append(pinnedSection);
    root.append(noResultsLabel);
    root.append(scrolled);
    root.append(searchBox);
    render();
    // @ts-ignore
    root.searchEntry = searchEntry;
    return root;
}
