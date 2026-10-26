import type { NoteNode } from "../../lib/notesStore"

// La nota se escribe como texto plano y se lee como un esquema estilo Python:
// una línea que termina en ":" seguida de líneas más indentadas es una
// subnota. Las líneas en blanco quedan dentro del bloque si lo siguiente
// sigue indentado, igual que en Python.

export interface Line {
    index: number // línea del buffer
    text: string // sin la indentación
    indent: number // caracteres de indentación al inicio de la línea
    parent: Line | null
    children: Line[]
    end: number // última línea del buffer del subárbol
}

const TAB_WIDTH = 4

// "- Correcciones de clase 21/07 - tachado", "... - listo", "... ✓"
export const DONE_RE = /(?:[-–]\s*(?:listo|tachado)|✓)\s*$/i
export const CHECKBOX_RE = /^([-*+]\s+)\[([ xX])\]\s/

export function isDone(line: Line): boolean {
    return DONE_RE.test(line.text) || /^[xX]$/.test(line.text.match(CHECKBOX_RE)?.[2] ?? "")
}

export function isSubnote(line: Line): boolean {
    return line.text.trimEnd().endsWith(":") && line.children.some((c) => c.text !== "")
}

// Título de la subnota para el encabezado: sin viñeta ni ":" final.
export function subnoteTitle(line: Line): string {
    return line.text.replace(/^[-*•\s]+/, "").replace(/:\s*$/, "")
}

function indentWidth(ws: string): number {
    let width = 0
    for (const ch of ws) width += ch === "\t" ? TAB_WIDTH : 1
    return width
}

export function parse(text: string): { roots: Line[]; lines: Line[] } {
    const roots: Line[] = []
    const lines: Line[] = []
    const stack: { line: Line; width: number }[] = []
    let blanks: Line[] = []

    const attach = (line: Line, parent: Line | null) => {
        line.parent = parent
        ;(parent ? parent.children : roots).push(line)
    }

    text.split("\n").forEach((raw, index) => {
        const ws = raw.match(/^[ \t]*/)![0]
        const line: Line = { index, text: raw.slice(ws.length), indent: ws.length, parent: null, children: [], end: index }
        lines.push(line)

        if (line.text.trim() === "") {
            blanks.push(line)
            return
        }

        const width = indentWidth(ws)
        while (stack.length && stack[stack.length - 1].width >= width) stack.pop()
        const parent = stack.length ? stack[stack.length - 1].line : null
        for (const blank of blanks) attach(blank, parent)
        blanks = []
        attach(line, parent)
        stack.push({ line, width })
    })
    for (const blank of blanks) attach(blank, null)

    const setEnd = (line: Line): number => {
        for (const child of line.children) line.end = Math.max(line.end, setEnd(child))
        return line.end
    }
    roots.forEach(setEnd)

    return { roots, lines }
}

export function toTree(lines: Line[]): NoteNode[] {
    return lines.map((line) =>
        line.children.length ? { text: line.text, children: toTree(line.children) } : { text: line.text },
    )
}

export function toText(nodes: NoteNode[], depth = 0): string {
    return nodes
        .map((node) => {
            const own = node.text === "" ? "" : "\t".repeat(depth) + node.text
            return node.children?.length ? `${own}\n${toText(node.children, depth + 1)}` : own
        })
        .join("\n")
}

// Lo mismo, pero sobre el árbol que se guarda (NoteNode).
export function isDoneNode(node: NoteNode): boolean {
    return DONE_RE.test(node.text) || /^[-*+]\s+\[[xX]\]\s/.test(node.text)
}

export function isSubnoteNode(node: NoteNode): boolean {
    return node.text.trimEnd().endsWith(":") && (node.children ?? []).some((c) => c.text !== "")
}

export function nodeTitle(node: NoteNode): string {
    return node.text.replace(/^(#{1,3}\s+|>\s?)?([-*+•]\s+(\[[ xX]\]\s+)?)?/, "").replace(/[*_~`]/g, "").replace(/:\s*$/, "")
}
