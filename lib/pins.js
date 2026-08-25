var _a;
const { GObject, GLib, Gio } = imports.gi;
const ByteArray = imports.byteArray;
const PINS_FILE = `${GLib.get_user_config_dir()}/ags/pinned.json`;
// Use GObject.registerClass if available (standard in GJS)
// Since we are in TypeScript, we'll use a class-based approach that GJS supports.
export class PinsService extends GObject.Object {
    static get_default() {
        if (!this._instance) {
            this._instance = new _a();
        }
        return this._instance;
    }
    constructor() {
        super();
        this._data = { menu: [], sidebar: [] };
        this.load();
    }
    logError(msg, e) {
        // @ts-ignore
        if (typeof print !== 'undefined')
            print(`${msg} ${e}`);
    }
    load() {
        if (!GLib.file_test(PINS_FILE, GLib.FileTest.EXISTS)) {
            this._data = {
                menu: [
                    "LmStudio.desktop",
                    "Windsurf.desktop",
                    "steam.desktop",
                    "Wuthering Waves.desktop",
                    "The Honkers Railway Launcher.desktop",
                    "TLauncher.desktop",
                    "No Man's Sky.desktop",
                    "Waydroid.desktop",
                    "rustdesk.desktop",
                ],
                sidebar: [
                    "ptyxis.desktop",
                    "org.gnome.Nautilus.desktop",
                    "firefox.desktop",
                    "steam.desktop",
                ]
            };
            this.save();
        }
        else {
            try {
                const [ok, contents] = GLib.file_get_contents(PINS_FILE);
                if (ok) {
                    this._data = JSON.parse(ByteArray.toString(contents));
                }
            }
            catch (e) {
                this.logError("Error loading pins:", e);
            }
        }
    }
    save() {
        try {
            const dir = GLib.path_get_dirname(PINS_FILE);
            if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) {
                GLib.mkdir_with_parents(dir, 0o755);
            }
            const contents = JSON.stringify(this._data, null, 2);
            GLib.file_set_contents(PINS_FILE, contents);
        }
        catch (e) {
            this.logError("Error saving pins:", e);
        }
    }
    getMenu() {
        return this._data.menu;
    }
    getSidebar() {
        return this._data.sidebar;
    }
    isPinnedMenu(id) {
        return this._data.menu.includes(id) || this._data.menu.includes(id + ".desktop");
    }
    isPinnedSidebar(id) {
        return this._data.sidebar.includes(id) || this._data.sidebar.includes(id + ".desktop");
    }
    toggleMenu(id) {
        const index = this._data.menu.indexOf(id);
        if (index > -1) {
            this._data.menu.splice(index, 1);
        }
        else {
            this._data.menu.push(id);
        }
        this.emit('menu-changed');
        this.save();
    }
    toggleSidebar(id) {
        const index = this._data.sidebar.indexOf(id);
        if (index > -1) {
            this._data.sidebar.splice(index, 1);
        }
        else {
            this._data.sidebar.push(id);
        }
        this.emit('sidebar-changed');
        this.save();
    }
}
_a = PinsService;
// Define signals
(() => {
    GObject.registerClass({
        GTypeName: 'PinsService',
        Signals: {
            'menu-changed': {},
            'sidebar-changed': {},
        },
    }, _a);
})();
export default PinsService.get_default();
