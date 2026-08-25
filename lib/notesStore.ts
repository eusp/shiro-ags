import GLib from "gi://GLib"

const NOTES_FILE = `${GLib.get_user_config_dir()}/ags/notes.json`

export interface NotesData {
    text: string
    marginTop: number
    marginLeft: number
    width: number
    height: number
}

const DEFAULTS: NotesData = {
    text: "",
    marginTop: 80,
    marginLeft: 80,
    width: 260,
    height: 220,
}

function load(): NotesData {
    if (!GLib.file_test(NOTES_FILE, GLib.FileTest.EXISTS)) {
        return { ...DEFAULTS }
    }
    try {
        const [ok, contents] = GLib.file_get_contents(NOTES_FILE)
        if (!ok) return { ...DEFAULTS }
        const parsed = JSON.parse(new TextDecoder().decode(contents))
        return { ...DEFAULTS, ...parsed }
    } catch (e) {
        console.warn("notesStore: failed to load", e)
        return { ...DEFAULTS }
    }
}

let data: NotesData = load()
let saveTimeoutId = 0

function persist() {
    try {
        const dir = GLib.path_get_dirname(NOTES_FILE)
        if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) {
            GLib.mkdir_with_parents(dir, 0o755)
        }
        GLib.file_set_contents(NOTES_FILE, JSON.stringify(data, null, 2))
    } catch (e) {
        console.warn("notesStore: failed to save", e)
    }
}

export function getNotes(): NotesData {
    return data
}

export function updateNotes(partial: Partial<NotesData>, debounceMs = 0) {
    data = { ...data, ...partial }

    if (saveTimeoutId) {
        GLib.source_remove(saveTimeoutId)
        saveTimeoutId = 0
    }

    if (debounceMs <= 0) {
        persist()
        return
    }

    saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, debounceMs, () => {
        saveTimeoutId = 0
        persist()
        return GLib.SOURCE_REMOVE
    })
}
