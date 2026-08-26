// Lightweight stand-in for AstalApps: wraps Gio.AppInfo (which the codebase
// already used directly elsewhere) instead of relying on astal's native
// binding (only available bundled with an old, unrelated astal-libs build
// that drifts out of sync with the system's actual astal version).
//
// Only implements what's actually used: a static `.list` (nothing here
// subscribes to change notifications) and `wm_class` derived from the
// desktop entry's StartupWMClass, matching how AstalApps sourced it.
import Gio from "gi://Gio?version=2.0";
export class App {
    constructor(appInfo) {
        this.id = (appInfo.get_id && appInfo.get_id()) || "";
        this.name = (appInfo.get_display_name && appInfo.get_display_name()) || (appInfo.get_name && appInfo.get_name()) || "";
        this.wm_class = (appInfo.get_startup_wm_class && appInfo.get_startup_wm_class()) || "";
    }
}
export default class Apps {
    constructor() {
        this.list = (Gio.AppInfo.get_all() || [])
            .filter((a) => a && (!a.should_show || a.should_show()))
            .map((a) => new App(a));
    }
}
