import GLib from "gi://GLib"
import { stateFile } from "./localState"

const NOTES_FILE = stateFile("notes.json")

// Cada línea de la nota con sus líneas indentadas debajo (subnotas).
export interface NoteNode {
    text: string
    children?: NoteNode[]
}

export interface NotesData {
    notes: NoteNode[]
    // Formato anterior: toda la nota en un string. Notes.tsx lo convierte a
    // `notes` al abrir y lo quita al guardar.
    text?: string
    showDone: boolean
    marginTop: number
    marginLeft: number
    width: number
    height: number
}

const DEFAULTS: NotesData = {
    notes: [],
    showDone: false,
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
