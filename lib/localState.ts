import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

// Local shell state (notes, pins, bluetooth devices, notifications), ignored by git.
const CONFIG_DIR = `${GLib.get_user_config_dir()}/ags`
const STATE_DIR = `${CONFIG_DIR}/state`

// Creates state/ on a fresh install and moves in the file older versions left loose in the root.
export function stateFile(name: string): string {
    GLib.mkdir_with_parents(STATE_DIR, 0o755)
    const path = `${STATE_DIR}/${name}`
    const legacy = `${CONFIG_DIR}/${name}`
    if (!GLib.file_test(path, GLib.FileTest.EXISTS) && GLib.file_test(legacy, GLib.FileTest.EXISTS)) {
        try {
            Gio.File.new_for_path(legacy).move(Gio.File.new_for_path(path), Gio.FileCopyFlags.NONE, null, null)
        } catch (e) {
            logError(e as Error, `localState: could not move ${legacy} into state/`)
        }
    }
    return path
}
