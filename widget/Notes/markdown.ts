// Conversión entre una línea de Markdown (lo que se guarda en notes.json) y
// lo que muestra el editor: texto limpio + estilos. En el editor no queda
// ningún símbolo: GTK 4 aborta el proceso con texto invisible, así que no se
// pueden ocultar, hay que quitarlos.

export type InlineStyle = "bold" | "italic" | "strike" | "code"
export type LineKind = "text" | "bullet" | "check" | "checked"

export interface Span {
    from: number // índices JS dentro de `content`
    to: number
    style: InlineStyle
}

export interface RichLine {
    kind: LineKind
    heading: number // 0 = no es título
    quote: boolean
    content: string
    spans: Span[]
}

export interface Segment {
    text: string
    styles: Set<InlineStyle>
}

// Viñetas y casillas son texto de verdad en el editor.
export const GLYPHS: Record<Exclude<LineKind, "text">, string> = {
    bullet: "• ",
    check: "☐ ",
    checked: "☑ ",
}
export const GLYPH_RE = /^([•☐☑]) /

export function kindOfGlyph(glyph: string): LineKind {
    return glyph === "•" ? "bullet" : glyph === "☐" ? "check" : "checked"
}

// Cursiva con "_": con "*", negrita que termina en cursiva daría "***", que
// no se puede leer de vuelta.
const MARKS: Record<InlineStyle, string> = { bold: "**", italic: "_", strike: "~~", code: "`" }
const ORDER: InlineStyle[] = ["bold", "italic", "strike", "code"]

// `código` | **negrita** (también ****x****; con número impar, ***x***,
// además cursiva) | ~~tachado~~ | *cursiva* | _cursiva_
const INLINE_RE =
    /`([^`\n]+)`|(?<!\*)(\*{2,})(?=[^\s*])(.+?)(?<=[^\s*])\2(?!\*)|~~(?=\S)(.+?)(?<=\S)~~|(?<![*\p{L}\p{N}])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\p{L}\p{N}])|(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/u

function parseInline(s: string, out: { content: string; spans: Span[] }, active: InlineStyle[]) {
    const push = (text: string, styles: InlineStyle[]) => {
        const from = out.content.length
        out.content += text
        for (const style of styles) out.spans.push({ from, to: out.content.length, style })
    }
    while (s) {
        const m = s.match(INLINE_RE)
        if (!m) return push(s, active)
        push(s.slice(0, m.index), active)
        if (m[1] !== undefined) push(m[1], [...active, "code"])
        else if (m[2]) parseInline(m[3], out, [...active, "bold", ...(m[2].length % 2 ? (["italic"] as const) : [])])
        else if (m[4] !== undefined) parseInline(m[4], out, [...active, "strike"])
        else parseInline(m[5] ?? m[6], out, [...active, "italic"])
        s = s.slice(m.index! + m[0].length)
    }
}

export function mdToRich(text: string): RichLine {
    let rest = text
    let heading = 0
    let quote = false
    let kind: LineKind = "text"
    let m: RegExpMatchArray | null

    if ((m = rest.match(/^(#{1,3})\s+/))) {
        heading = m[1].length
        rest = rest.slice(m[0].length)
    } else if ((m = rest.match(/^>\s?/))) {
        quote = true
        rest = rest.slice(m[0].length)
    }
    if ((m = rest.match(/^[-*+]\s+\[([ xX])\]\s/))) {
        kind = m[1] === " " ? "check" : "checked"
        rest = rest.slice(m[0].length)
    } else if ((m = rest.match(/^[-*+•]\s+/))) {
        kind = "bullet"
        rest = rest.slice(m[0].length)
    }

    const out = { content: "", spans: [] as Span[] }
    parseInline(rest, out, [])
    return { kind, heading, quote, ...out }
}

function inlineToMd(segments: Segment[]): string {
    let out = ""
    const open: InlineStyle[] = []

    // Cierra hasta que solo queden abiertos estilos de `keep`. Los espacios
    // del final quedan fuera del símbolo ("**hola** ", no "**hola **").
    const closeTo = (keep: Set<InlineStyle>) => {
        const idx = open.findIndex((s) => !keep.has(s))
        if (idx < 0) return
        const trailing = out.match(/\s*$/)![0]
        out = out.slice(0, out.length - trailing.length)
        while (open.length > idx) out += MARKS[open.pop()!]
        out += trailing
    }

    for (const seg of segments) {
        closeTo(seg.styles)
        let text = seg.text
        const toOpen = ORDER.filter((s) => seg.styles.has(s) && !open.includes(s))
        if (toOpen.length) {
            const lead = text.match(/^\s*/)![0]
            out += lead
            text = text.slice(lead.length)
            if (!text) continue
            for (const s of toOpen) {
                out += MARKS[s]
                open.push(s)
            }
        }
        out += text
    }
    closeTo(new Set())
    return out
}

export function richToMd(line: { kind: LineKind; heading: number; quote: boolean; segments: Segment[]; subnote: boolean }): string {
    const block = line.heading ? "#".repeat(line.heading) + " " : line.quote ? "> " : ""
    const list = { text: "", bullet: "- ", check: "- [ ] ", checked: "- [x] " }[line.kind]
    let body = inlineToMd(line.segments)
    if (line.subnote && !body.trimEnd().endsWith(":")) body = (body.trimEnd() || "Sin título") + ":"
    return block + list + body
}
