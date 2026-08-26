var _a;
// Lightweight stand-in for AstalTray: implements the StatusNotifierWatcher/
// StatusNotifierItem/DBusMenu protocols directly instead of relying on
// astal's native binding (only available bundled with an old, unrelated
// astal-libs build that drifts out of sync with the system's actual astal
// version). AstalTray also *provided* the watcher role itself, so dropping
// it silently would break tray icons for every app on the system — this
// takes that role over.
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
const WATCHER_BUS_NAME = "org.kde.StatusNotifierWatcher";
const WATCHER_IFACE_NAME = "org.kde.StatusNotifierWatcher";
const WATCHER_OBJECT_PATH = "/StatusNotifierWatcher";
const WATCHER_IFACE_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg type="s" name="service" direction="in"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg type="s" name="service" direction="in"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
  </interface>
</node>`;
const ITEM_IFACE = "org.kde.StatusNotifierItem";
const MENU_IFACE = "com.canonical.dbusmenu";
function fetchLayout(menuProxy) {
    try {
        const result = menuProxy.call_sync("GetLayout", new GLib.Variant("(iias)", [0, -1, []]), Gio.DBusCallFlags.NONE, -1, null);
        const [, root] = result.recursiveUnpack();
        const toNode = (n) => ({
            id: n[0],
            properties: n[1] || {},
            children: (n[2] || []).map(toNode),
        });
        return toNode(root);
    }
    catch (e) {
        logError(e, "tray: GetLayout failed");
        return null;
    }
}
function sendMenuEvent(menuProxy, id, eventId) {
    try {
        menuProxy.call("Event", new GLib.Variant("(isvu)", [id, eventId, new GLib.Variant("i", 0), Math.floor(Date.now() / 1000)]), Gio.DBusCallFlags.NONE, -1, null, null);
    }
    catch (e) {
        logError(e, "tray: Event failed");
    }
}
// Mutates `target` in place (rather than returning a fresh Gio.Menu) so the
// same object identity handed to the widget as `item.menu_model` keeps
// working after a LayoutUpdated refresh — GMenuModel change notifications
// propagate up from nested sections/submenus into any popover already
// showing it.
function populateMenu(target, node, menuProxy, actionGroup, actionPrefix) {
    target.remove_all();
    let section = new Gio.Menu();
    const flushSection = () => {
        if (section.get_n_items() > 0)
            target.append_section(null, section);
        section = new Gio.Menu();
    };
    for (const child of node.children) {
        const props = child.properties || {};
        if (props.visible === false)
            continue;
        if (props.type === "separator") {
            flushSection();
            continue;
        }
        const label = typeof props.label === "string" && props.label.length > 0 ? props.label : "…";
        if (child.children && child.children.length > 0) {
            const submenu = new Gio.Menu();
            populateMenu(submenu, child, menuProxy, actionGroup, actionPrefix);
            section.append_submenu(label, submenu);
        }
        else {
            const actionName = `item-${child.id}`;
            let action = actionGroup.lookup_action(actionName);
            if (!action) {
                action = new Gio.SimpleAction({ name: actionName });
                action.connect("activate", () => sendMenuEvent(menuProxy, child.id, "clicked"));
                actionGroup.add_action(action);
            }
            action.set_enabled(props.enabled !== false);
            section.append(label, `${actionPrefix}.${actionName}`);
        }
    }
    flushSection();
}
// ─── Icon ────────────────────────────────────────────────────────────────
function pixmapToGicon(pixmaps) {
    if (!pixmaps || pixmaps.length === 0)
        return null;
    // Prefer the largest variant offered.
    const [w, h, argb] = pixmaps.reduce((a, b) => (b[0] * b[1] > a[0] * a[1] ? b : a));
    if (!w || !h || !argb || argb.length < w * h * 4)
        return null;
    // StatusNotifierItem pixmaps are ARGB32 in network (big-endian) byte
    // order; GdkPixbuf wants row-major RGBA bytes.
    const rgba = new Uint8Array(argb.length);
    for (let i = 0; i < argb.length; i += 4) {
        rgba[i] = argb[i + 1];
        rgba[i + 1] = argb[i + 2];
        rgba[i + 2] = argb[i + 3];
        rgba[i + 3] = argb[i];
    }
    try {
        const bytes = GLib.Bytes.new(rgba);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(bytes, GdkPixbuf.Colorspace.RGB, true, 8, w, h, w * 4);
        // Gio.Icon needs loadable image bytes (not raw pixels), so re-encode as PNG.
        const [, pngBytes] = pixbuf.save_to_bufferv("png", [], []);
        return Gio.BytesIcon.new(GLib.Bytes.new(pngBytes));
    }
    catch (e) {
        logError(e, "tray: pixmap conversion failed");
        return null;
    }
}
// ─── Tray Item ───────────────────────────────────────────────────────────
export class TrayItem {
    constructor(busName, objectPath) {
        this.gicon = null;
        this.menu_model = null;
        this.action_group = null;
        this._itemProxy = null;
        this._menuProxy = null;
        this._busName = busName;
        this._objectPath = objectPath;
        this.id = `${busName}${objectPath}`;
        this._connect();
    }
    _connect() {
        try {
            this._itemProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, this._busName, this._objectPath, ITEM_IFACE, null);
        }
        catch (e) {
            logError(e, `tray: could not connect to item ${this.id}`);
            return;
        }
        this._refreshIcon();
        const menuPath = this._readProp("Menu");
        if (menuPath) {
            try {
                this._menuProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, this._busName, menuPath, MENU_IFACE, null);
                this.action_group = new Gio.SimpleActionGroup();
                this.menu_model = new Gio.Menu();
                this._refreshMenu();
                this._menuProxy.connect("g-signal", (_p, _sender, signal) => {
                    if (signal === "LayoutUpdated")
                        this._refreshMenu();
                });
            }
            catch (e) {
                logError(e, `tray: could not connect to menu for ${this.id}`);
            }
        }
    }
    _readProp(name) {
        const v = this._itemProxy?.get_cached_property(name);
        return v ? v.deep_unpack() : null;
    }
    _refreshIcon() {
        const iconName = this._readProp("IconName") || "";
        const themePath = this._readProp("IconThemePath") || "";
        if (iconName) {
            if (iconName.startsWith("/")) {
                this.gicon = Gio.FileIcon.new(Gio.File.new_for_path(iconName));
            }
            else {
                if (themePath) {
                    const display = Gdk.Display.get_default();
                    if (display)
                        Gtk.IconTheme.get_for_display(display).add_search_path(themePath);
                }
                this.gicon = Gio.ThemedIcon.new(iconName);
            }
            return;
        }
        const pixmaps = this._readProp("IconPixmap");
        const pix = pixmapToGicon(pixmaps);
        this.gicon = pix ?? Gio.ThemedIcon.new("image-missing-symbolic");
    }
    _refreshMenu() {
        if (!this._menuProxy || !this.menu_model || !this.action_group)
            return;
        const layout = fetchLayout(this._menuProxy);
        if (!layout)
            return;
        populateMenu(this.menu_model, layout, this._menuProxy, this.action_group, "dbusmenu");
    }
}
// ─── Watcher / Tray singleton ───────────────────────────────────────────
const Tray = GObject.registerClass({
    GTypeName: "ShiroTray",
    Properties: {
        items: GObject.ParamSpec.jsobject("items", "items", "items", GObject.ParamFlags.READABLE),
    },
}, (_a = class Tray extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._items = new Map();
            this._connection = null;
            this._own();
        }
        get items() {
            return Array.from(this._items.values());
        }
        _register(busName, objectPath) {
            const id = `${busName}${objectPath}`;
            if (this._items.has(id))
                return;
            this._items.set(id, new TrayItem(busName, objectPath));
            this.notify("items");
            if (this._connection) {
                try {
                    this._connection.emit_signal(null, WATCHER_OBJECT_PATH, WATCHER_IFACE_NAME, "StatusNotifierItemRegistered", new GLib.Variant("(s)", [id]));
                }
                catch (e) {
                    logError(e, "shiro-tray: failed to emit StatusNotifierItemRegistered");
                }
            }
        }
        _own() {
            // Uses the raw register_object API (not DBusExportedObject.wrapJSObject)
            // because RegisterStatusNotifierItem needs the caller's bus name, and
            // wrapJSObject in this GJS version always passes a null invocation —
            // register_object's method_call handler gets the real sender directly.
            Gio.bus_own_name(Gio.BusType.SESSION, WATCHER_BUS_NAME, Gio.BusNameOwnerFlags.NONE, (connection) => {
                this._connection = connection;
                const nodeInfo = Gio.DBusNodeInfo.new_for_xml(WATCHER_IFACE_XML);
                const ifaceInfo = nodeInfo.lookup_interface(WATCHER_IFACE_NAME);
                connection.register_object(WATCHER_OBJECT_PATH, ifaceInfo, (_conn, sender, _objPath, _iface, method, params, invocation) => {
                    if (method === "RegisterStatusNotifierItem") {
                        const [service] = params.deep_unpack();
                        // Clients disagree on what `service` contains: some pass just
                        // their bus name (default object path applies), some pass
                        // "busname/path" combined, and some (e.g.
                        // libayatana-appindicator, seen from rustdesk) pass only the
                        // object path and expect the watcher to use the call's sender
                        // as the bus name.
                        let busName;
                        let objectPath;
                        if (service.startsWith("/")) {
                            busName = sender;
                            objectPath = service;
                        }
                        else {
                            const slash = service.indexOf("/");
                            if (slash !== -1) {
                                busName = service.slice(0, slash);
                                objectPath = service.slice(slash);
                            }
                            else {
                                busName = service;
                                objectPath = "/StatusNotifierItem";
                            }
                        }
                        this._register(busName, objectPath);
                    }
                    invocation.return_value(null);
                }, (_conn, _sender, _objPath, _iface, propertyName) => {
                    if (propertyName === "RegisteredStatusNotifierItems") {
                        return new GLib.Variant("as", Array.from(this._items.keys()));
                    }
                    if (propertyName === "IsStatusNotifierHostRegistered") {
                        return new GLib.Variant("b", true);
                    }
                    if (propertyName === "ProtocolVersion") {
                        return new GLib.Variant("i", 0);
                    }
                    return null;
                }, null);
                // Watch every session-bus name loss to prune items whose owner disappeared —
                // StatusNotifierItemUnregistered isn't reliably called by clients on exit.
                connection.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged", "/org/freedesktop/DBus", null, Gio.DBusSignalFlags.NONE, (_c, _sender, _path, _iface, _signal, params) => {
                    const [name, , newOwner] = params.deep_unpack();
                    if (newOwner)
                        return;
                    for (const [id] of this._items) {
                        if (id.startsWith(name)) {
                            this._items.delete(id);
                            this.notify("items");
                        }
                    }
                });
            }, () => { }, () => {
                logError(new Error("shiro-tray: could not own org.kde.StatusNotifierWatcher — is another tray host running?"));
            });
        }
    },
    _a._instance = null,
    _a));
export default Tray;
