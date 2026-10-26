import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import type { NoteNode } from "../../lib/notesStore"
import { GLYPHS, GLYPH_RE, type InlineStyle, type LineKind, type Segment, kindOfGlyph, mdToRich, richToMd } from "./markdown"
import { isDoneNode, isSubnoteNode } from "./outline"

// Editor de texto enriquecido sobre un Gtk.TextView.
//
// El árbol de notas (NoteNode, en Markdown) es la fuente de verdad. El buffer
// muestra solo la parte visible: la raíz o la subnota abierta, sin las
// subnotas plegadas ni las completadas ocultas, y sin símbolos de Markdown
// (la negrita es un tag, la viñeta es "• "). Lo que no está en el buffer se
// cuelga de marcas en la línea donde iba, y al leer el buffer se vuelve a
// armar el árbol con eso.
//
// Nada de texto invisible: GTK 4 aborta el proceso entero ("Byte index off
// the end of the line") al hacer clic en una línea que lo tiene.

export const TEXT_MARGIN = 20
const INDENT_STEP = 22
const LIST_MARGIN = 18
const QUOTE_MARGIN = 14
const MAX_DEPTH = 8

const UPPER_WORD_RE = /(?<![\p{L}\p{N}])\p{Lu}[\p{Lu}\p{N}]+(?![\p{L}\p{N}])/gu
const STARTS_UPPER_RE = /^[^\p{L}\p{N}]*\p{Lu}[\p{Lu}\p{N}]+(?![\p{L}\p{N}])/u

export type Block = 0 | 1 | 2 | 3 | "quote"

// Lo que no está en el buffer y se cuelga de una línea.
interface Anchor {
    mark: Gtk.TextMark
    hiddenBefore: NoteNode[] // completadas ocultas, hermanas anteriores
    folded: NoteNode[] | null // hijos de una subnota plegada
}

// Una línea del buffer ya leída.
interface Item {
    line: number
    node: NoteNode
    depth: number
    kind: LineKind
    heading: number
    quote: boolean
    blank: boolean
    title: boolean // título de la subnota abierta
    parent: Item | null
    children: Item[]
    end: number // última línea del buffer de su subárbol
}

export interface EditorState {
    path: NoteNode[] // de la raíz a la subnota abierta ([] = nota completa)
    hidable: number // completadas que se pueden ocultar en esta vista
}

export interface EditorOptions {
    getNotes(): NoteNode[]
    setNotes(notes: NoteNode[]): void
    showDone(): boolean
    onState(state: EditorState): void
    onCursorBlock(block: Block): void
}

const chars = (s: string) => [...s].length

export function createEditor(view: Gtk.TextView, accent: Gtk.Widget, opts: EditorOptions) {
    const buffer = view.buffer
    const table = buffer.get_tag_table()

    // ─── Tags ────────────────────────────────────────────────────────────────

    const tag = (props: Partial<Gtk.TextTag.ConstructorProps>) => {
        const t = new Gtk.TextTag(props)
        table.add(t)
        return t
    }
    // Guardan la nota: se leen al convertir a Markdown.
    const inline: Record<InlineStyle, Gtk.TextTag> = {
        bold: tag({ weight: Pango.Weight.BOLD }),
        italic: tag({ style: Pango.Style.ITALIC }),
        strike: tag({ strikethrough: true }),
        code: tag({ family: "JetBrainsMono Nerd Font" }),
    }
    const headings = [
        tag({ weight: Pango.Weight.HEAVY, scale: 1.8, pixelsAboveLines: 16, pixelsBelowLines: 6 }),
        tag({ weight: Pango.Weight.BOLD, scale: 1.45, pixelsAboveLines: 12, pixelsBelowLines: 4 }),
        tag({ weight: Pango.Weight.BOLD, scale: 1.2, pixelsAboveLines: 8, pixelsBelowLines: 2 }),
    ]
    const quoteTag = tag({ style: Pango.Style.ITALIC })
    const subnoteTag = tag({}) // subnota plegada (sus hijos no están en el buffer)
    const depthTags: Gtk.TextTag[] = []
    for (let d = 0; d <= MAX_DEPTH; d++) depthTags.push(tag({}))
    const LINE_TAGS = [...headings, quoteTag, subnoteTag, ...depthTags]

    // Solo de vista: se recalculan en cada pasada (decorate).
    const deco = {
        paragraph: tag({ pixelsBelowLines: 6 }),
        spaced: tag({ pixelsAboveLines: 8 }), // interlineado superior de 1.5
        upper: tag({ weight: Pango.Weight.BOLD }),
        glyph: tag({ weight: Pango.Weight.BOLD }),
        link: tag({ weight: Pango.Weight.BOLD, pixelsAboveLines: 4, pixelsBelowLines: 4 }),
        title: tag({ weight: Pango.Weight.HEAVY, scale: 1.35, pixelsBelowLines: 10 }),
        done: tag({ strikethrough: true }),
    }
    const marginTags = new Map<string, Gtk.TextTag>()
    const marginTag = (margin: number, hang: number) => {
        const key = `${margin}:${hang}`
        let t = marginTags.get(key)
        if (!t) {
            // Con indent negativo la primera línea queda en el margen y las
            // siguientes se corren `hang` (alineadas después de la viñeta).
            t = tag({ leftMargin: margin, indent: -hang })
            marginTags.set(key, t)
        }
        return t
    }

    // Los TextTags no leen variables CSS: los colores salen del texto de la
    // vista y de `accent`, un widget pintado con var(--primary).
    let lastColors = ""
    const syncColors = () => {
        const fg = view.get_color()
        const primary = accent.get_color()
        const key = fg.to_string() + primary.to_string()
        if (key === lastColors) return
        lastColors = key
        const alpha = (c: typeof fg, a: number) => {
            const copy = c.copy()
            copy.alpha = a
            return copy
        }
        deco.done.foregroundRgba = alpha(fg, 0.45)
        quoteTag.foregroundRgba = alpha(fg, 0.7)
        quoteTag.paragraphBackgroundRgba = alpha(primary, 0.06)
        inline.code.backgroundRgba = alpha(fg, 0.1)
        deco.glyph.foregroundRgba = primary
        headings[0].foregroundRgba = primary
        deco.link.foregroundRgba = primary
        deco.link.paragraphBackgroundRgba = alpha(primary, 0.14)
        deco.title.foregroundRgba = primary
    }

    const widths = new Map<string, number>()
    const textWidth = (text: string) => {
        let w = widths.get(text)
        if (w === undefined) {
            w = view.create_pango_layout(text).get_pixel_size()[0]
            widths.set(text, w)
        }
        return w
    }

    // ─── Líneas del buffer ───────────────────────────────────────────────────

    const lineCount = () => buffer.get_line_count()
    const lineStart = (l: number) => buffer.get_iter_at_line(l)[1]
    const lineEnd = (l: number) => {
        const it = lineStart(l)
        if (!it.ends_line()) it.forward_to_line_end()
        return it
    }
    // Incluye el salto de línea: así una línea vacía también lleva sus tags.
    const lineRangeEnd = (l: number) => (l + 1 < lineCount() ? lineStart(l + 1) : buffer.get_end_iter())
    const lineText = (l: number) => buffer.get_text(lineStart(l), lineEnd(l), true)
    const lineTagsOf = (it: Gtk.TextIter) => it.get_tags().filter((t) => LINE_TAGS.includes(t))
    const setLineTags = (l: number, tags: Gtk.TextTag[]) => {
        const s = lineStart(l)
        const e = lineRangeEnd(l)
        for (const t of LINE_TAGS) buffer.remove_tag(t, s, e)
        for (const t of tags) buffer.apply_tag(t, s, e)
    }
    const depthOf = (l: number) => {
        const t = lineTagsOf(lineStart(l)).find((t) => depthTags.includes(t))
        return t ? depthTags.indexOf(t) : 0
    }
    const glyphLen = (l: number) => (GLYPH_RE.test(lineText(l)) ? 2 : 0)
    const iterAt = (l: number, offset: number) => {
        const it = lineStart(l)
        it.forward_chars(offset)
        return it
    }
    const cursorIter = () => buffer.get_iter_at_mark(buffer.get_insert())
    // Estilos del carácter antes de `it` en la misma línea.
    const stylesBefore = (it: Gtk.TextIter) => {
        const styles = new Set<InlineStyle>()
        const src = it.copy()
        if (src.starts_line() || !src.backward_char()) return styles
        for (const [style, t] of Object.entries(inline) as [InlineStyle, Gtk.TextTag][]) if (src.has_tag(t)) styles.add(style)
        return styles
    }
    const selectedLines = () => {
        const [, s, e] = buffer.get_selection_bounds()
        let last = e.get_line()
        if (last > s.get_line() && e.starts_line()) last--
        const out: number[] = []
        for (let l = s.get_line(); l <= last; l++) out.push(l)
        return out
    }
    const userAction = (fn: () => void) => {
        buffer.begin_user_action()
        try {
            fn()
        } finally {
            buffer.end_user_action()
        }
    }

    // ─── Estado ──────────────────────────────────────────────────────────────

    let path: NoteNode[] = []
    let anchors: Anchor[] = []
    let items: Item[] = []
    let hidable = 0
    let rendering = false
    let inserting = false
    let autoformatting = false
    let lastInsert: { text: string; line: number } | null = null
    let lastDeleteLine = -1
    // Estilo para lo próximo que se escriba (botón B sin selección).
    let typingStyles: Set<InlineStyle> | null = null
    // Prefijo de lista del título de la subnota abierta, que no se muestra.
    let titleKind: LineKind = "text"

    const scope = () => path[path.length - 1] ?? null

    // ─── Árbol → buffer ──────────────────────────────────────────────────────

    interface Row {
        node: NoteNode
        depth: number
        title: boolean
        rich: ReturnType<typeof mdToRich>
        folded: NoteNode[] | null
        hiddenBefore: NoteNode[]
    }

    // `keepOpen`: nodos que contienen el cursor y no se pliegan ni ocultan.
    function render(target: { node: NoteNode; offset: number } | null, keepOpen = new Set<NoteNode>()) {
        const rows: Row[] = []
        hidable = 0
        const showDone = opts.showDone()

        const emit = (nodes: NoteNode[], depth: number) => {
            const done = nodes.filter(isDoneNode)
            const lastDone = done[done.length - 1]
            hidable += Math.max(0, done.length - 1)
            let hidden: NoteNode[] = []
            for (const node of nodes) {
                if (!showDone && node !== lastDone && isDoneNode(node) && !keepOpen.has(node)) {
                    hidden.push(node)
                    continue
                }
                const fold = isSubnoteNode(node) && !keepOpen.has(node)
                const text = fold ? node.text.replace(/:\s*$/, "") : node.text
                rows.push({ node, depth, title: false, rich: mdToRich(text), folded: fold ? node.children! : null, hiddenBefore: hidden })
                hidden = []
                if (!fold) emit(node.children ?? [], depth + 1)
            }
        }

        const focus = scope()
        if (focus) {
            const rich = mdToRich(focus.text.replace(/:\s*$/, ""))
            titleKind = rich.kind
            rows.push({ node: focus, depth: 0, title: true, rich: { ...rich, kind: "text" }, folded: null, hiddenBefore: [] })
            emit(focus.children ?? [], 0)
        } else {
            emit(opts.getNotes(), 0)
        }
        if (!rows.length) rows.push({ node: { text: "" }, depth: 0, title: false, rich: mdToRich(""), folded: null, hiddenBefore: [] })

        rendering = true
        for (const a of anchors) buffer.delete_mark(a.mark)
        anchors = []
        buffer.begin_irreversible_action()
        const prefix = (r: Row) => (r.rich.kind === "text" ? "" : GLYPHS[r.rich.kind])
        buffer.set_text(rows.map((r) => prefix(r) + r.rich.content).join("\n"), -1)

        rows.forEach((r, l) => {
            const lineTags = [depthTags[Math.min(r.depth, MAX_DEPTH)]]
            if (r.rich.heading) lineTags.push(headings[r.rich.heading - 1])
            if (r.rich.quote) lineTags.push(quoteTag)
            if (r.folded) lineTags.push(subnoteTag)
            setLineTags(l, lineTags)

            const base = chars(prefix(r))
            for (const span of r.rich.spans) {
                const from = base + chars(r.rich.content.slice(0, span.from))
                const to = base + chars(r.rich.content.slice(0, span.to))
                buffer.apply_tag(inline[span.style], iterAt(l, from), iterAt(l, to))
            }
            if (r.folded || r.hiddenBefore.length) {
                // Gravedad derecha: si se escribe o se da Enter al inicio de la
                // línea, la marca se queda con el texto original.
                anchors.push({ mark: buffer.create_mark(null, lineStart(l), false), hiddenBefore: r.hiddenBefore, folded: r.folded })
            }
        })
        buffer.end_irreversible_action()
        rendering = false

        let line = 0
        let offset = 0
        if (target) {
            const index = rows.findIndex((r) => r.node === target.node)
            if (index >= 0) {
                line = index
                offset = Math.min(target.offset, chars(lineText(index)))
            }
        }
        buffer.place_cursor(iterAt(line, offset))
        sync()
        decorate()
        // Antes de que la vista tenga tamaño, scroll_to_mark la deja sin
        // pintar nada (en la carga inicial).
        if (view.get_mapped()) view.scroll_to_mark(buffer.get_insert(), 0.1, false, 0, 0)
    }

    // ─── Buffer → árbol ──────────────────────────────────────────────────────

    function segmentsOf(l: number, from: number): Segment[] {
        const segs: Segment[] = []
        const it = iterAt(l, from)
        const end = lineEnd(l)
        while (it.compare(end) < 0) {
            const next = it.copy()
            next.forward_to_tag_toggle(null)
            if (next.compare(end) > 0) next.assign(end)
            const styles = new Set<InlineStyle>()
            for (const [style, t] of Object.entries(inline) as [InlineStyle, Gtk.TextTag][]) if (it.has_tag(t)) styles.add(style)
            segs.push({ text: buffer.get_text(it, next, true), styles })
            it.assign(next)
        }
        return segs
    }

    function sync() {
        const anchorsAt = new Map<number, Anchor[]>()
        for (const a of anchors) {
            const l = buffer.get_iter_at_mark(a.mark).get_line()
            anchorsAt.set(l, [...(anchorsAt.get(l) ?? []), a])
        }

        const focus = scope()
        items = []
        const roots: NoteNode[] = []
        const stack: Item[] = []
        let pending: NoteNode[] = [] // blancos y ocultas que esperan a su padre

        const childrenOf = (item: Item | null) => {
            if (!item) return roots
            return (item.node.children ??= [])
        }

        for (let l = 0; l < lineCount(); l++) {
            const text = lineText(l)
            const tags = lineTagsOf(lineStart(l))
            const glyph = text.match(GLYPH_RE)
            const title = !!focus && l === 0
            const kind = title ? titleKind : glyph ? kindOfGlyph(glyph[1]) : "text"
            const heading = headings.findIndex((t) => tags.includes(t)) + 1
            const quote = tags.includes(quoteTag)
            const here = anchorsAt.get(l) ?? []
            const folded = here.flatMap((a) => a.folded ?? [])
            const hiddenBefore = here.flatMap((a) => a.hiddenBefore)
            // Solo cuenta como plegada si de verdad tiene hijos colgados.
            const subnote = tags.includes(subnoteTag) && folded.length > 0
            const md = richToMd({ kind, heading, quote, subnote: subnote || title, segments: segmentsOf(l, glyph ? 2 : 0) })

            const node: NoteNode = { text: md }
            if (folded.length) node.children = [...folded]
            const item: Item = {
                line: l,
                node,
                depth: depthOf(l),
                kind,
                heading,
                quote,
                blank: text.trim() === "" && !folded.length,
                title,
                parent: null,
                children: [],
                end: l,
            }
            items.push(item)

            if (title) {
                focus!.text = md
                continue
            }
            if (item.blank) {
                pending.push(...hiddenBefore, node)
                continue
            }
            while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop()
            const parent = stack[stack.length - 1] ?? null
            item.parent = parent
            parent?.children.push(item)
            childrenOf(parent).push(...pending, ...hiddenBefore, node)
            pending = []
            stack.push(item)
        }
        roots.push(...pending)

        // Hasta dónde llega cada subárbol en el buffer.
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i]
            for (const child of item.children) item.end = Math.max(item.end, child.end)
        }

        const tidy = (nodes: NoteNode[]) => {
            for (const n of nodes) {
                if (n.children?.length) tidy(n.children)
                else delete n.children
            }
        }
        tidy(roots)

        if (focus) {
            if (roots.length) focus.children = roots
            else delete focus.children
            opts.setNotes(opts.getNotes())
        } else {
            opts.setNotes(roots)
        }
    }

    // ¿Hay algo a la vista que debería estar plegado u oculto, lejos del
    // cursor? (una subnota recién escrita, una completada que ya no es la
    // última). Si sí, se vuelve a pintar.
    function foldTarget(): { keepOpen: Set<NoteNode> } | null {
        const cursor = cursorIter().get_line()
        const holds = (item: Item) => cursor >= item.line && cursor <= item.end
        const showDone = opts.showDone()
        let needed = false

        const groups = new Map<Item | null, Item[]>()
        for (const item of items) {
            if (item.blank || item.title) continue
            groups.set(item.parent, [...(groups.get(item.parent) ?? []), item])
            if (isSubnoteNode(item.node) && item.children.length && !holds(item)) needed = true
        }
        if (!showDone) {
            for (const siblings of groups.values()) {
                const done = siblings.filter((i) => isDoneNode(i.node))
                if (done.slice(0, -1).some((i) => !holds(i))) needed = true
            }
        }
        if (!needed) return null

        const keepOpen = new Set<NoteNode>()
        for (let item: Item | null = items[cursor] ?? null; item; item = item.parent) keepOpen.add(item.node)
        return { keepOpen }
    }

    function decorate() {
        syncColors()
        const [start, end] = buffer.get_bounds()
        for (const t of Object.values(deco)) buffer.remove_tag(t, start, end)
        for (const t of marginTags.values()) buffer.remove_tag(t, start, end)

        for (const item of items) {
            const l = item.line
            const text = lineText(l)
            const glyph = item.title ? 0 : glyphLen(l)
            const s = lineStart(l)
            const e = lineRangeEnd(l)

            let margin = TEXT_MARGIN
            let hang = 0
            if (!item.title) {
                margin += item.depth * INDENT_STEP
                if (glyph) {
                    margin += LIST_MARGIN
                    hang = textWidth(text.slice(0, 2))
                }
                if (item.quote) margin += QUOTE_MARGIN
            }
            buffer.apply_tag(marginTag(margin, hang), s, e)
            if (glyph) buffer.apply_tag(deco.glyph, s, iterAt(l, 1))

            const content = text.slice(glyph)
            for (const m of content.matchAll(UPPER_WORD_RE)) {
                const from = glyph + chars(content.slice(0, m.index))
                buffer.apply_tag(deco.upper, iterAt(l, from), iterAt(l, from + chars(m[0])))
            }
            if (item.title) buffer.apply_tag(deco.title, s, e)
            else if (isSubnoteNode(item.node)) buffer.apply_tag(deco.link, s, e)
            else if (!item.heading && STARTS_UPPER_RE.test(content)) buffer.apply_tag(deco.spaced, s, e)
            else if (!item.heading && !item.quote && !glyph && content.trim()) buffer.apply_tag(deco.paragraph, s, e)
            if (!item.title && isDoneNode(item.node)) buffer.apply_tag(deco.done, iterAt(l, glyph), lineEnd(l))
        }

        opts.onState({ path: [...path], hidable })
        reportBlock()
    }

    function reportBlock() {
        const tags = lineTagsOf(lineStart(cursorIter().get_line()))
        const heading = headings.findIndex((t) => tags.includes(t)) + 1
        opts.onCursorBlock(heading ? (heading as Block) : tags.includes(quoteTag) ? "quote" : 0)
    }

    // ─── Atajos de Markdown al escribir ──────────────────────────────────────

    // Devuelve true si cambió el buffer (y entonces vuelve a pasar por aquí).
    function autoformat(): boolean {
        const insert = lastInsert
        const deletedAt = lastDeleteLine
        lastInsert = null
        lastDeleteLine = -1
        let changed = false
        const edit = (fn: () => void) => {
            autoformatting = true
            userAction(fn)
            autoformatting = false
            changed = true
        }

        if (deletedAt >= 0 && deletedAt < lineCount()) {
            // Se borró el espacio de "• ": fuera la viñeta entera.
            if (/^[•☐☑](?! )/.test(lineText(deletedAt))) edit(() => buffer.delete(lineStart(deletedAt), iterAt(deletedAt, 1)))
        }
        if (!insert || insert.line >= lineCount()) return changed
        const l = insert.line
        const text = lineText(l)

        if (insert.text === " ") {
            let m: RegExpMatchArray | null
            if ((m = text.match(/^(?:[-*+] |• )?\[([ xX]?)\] /))) {
                const glyph = m[1].trim() ? GLYPHS.checked : GLYPHS.check
                edit(() => {
                    buffer.delete(lineStart(l), iterAt(l, m![0].length))
                    buffer.insert(lineStart(l), glyph, -1)
                })
            } else if (/^[-*+] /.test(text)) {
                edit(() => {
                    buffer.delete(lineStart(l), iterAt(l, 2))
                    buffer.insert(lineStart(l), GLYPHS.bullet, -1)
                })
            } else if ((m = text.match(/^(#{1,3}) /))) {
                const level = m[1].length
                edit(() => {
                    buffer.delete(lineStart(l), iterAt(l, m![0].length))
                    applyBlock([l], level as Block)
                })
            } else if (/^> /.test(text)) {
                edit(() => {
                    buffer.delete(lineStart(l), iterAt(l, 2))
                    applyBlock([l], "quote")
                })
            }
        } else if (insert.text === "*" || insert.text === "~" || insert.text === "`") {
            const before = text.slice(0, cursorIter().get_line() === l ? cursorIter().get_line_offset() : text.length)
            const rules: [RegExp, InlineStyle, number][] = [
                [/`([^`\n]+)`$/, "code", 1],
                [/(?<!\*)\*\*([^*\n]+)\*\*$/, "bold", 2],
                [/~~([^~\n]+)~~$/, "strike", 2],
                [/(?<![*\p{L}\p{N}])\*([^*\s][^*\n]*)\*$/u, "italic", 1],
            ]
            for (const [re, style, len] of rules) {
                const m = before.match(re)
                if (!m || m[1].trim() !== m[1]) continue
                const start = chars(before.slice(0, m.index))
                const inner = chars(m[1])
                edit(() => {
                    buffer.delete(iterAt(l, start + len + inner), iterAt(l, start + 2 * len + inner))
                    buffer.delete(iterAt(l, start), iterAt(l, start + len))
                    buffer.apply_tag(inline[style], iterAt(l, start), iterAt(l, start + inner))
                })
                // Al cerrar **negrita**, lo que sigue ya no va en negrita.
                const after = new Set(stylesBefore(cursorIter()))
                after.delete(style)
                typingStyles = after
                break
            }
        } else if (insert.text === "\n" && l > 0) {
            // Enter en una lista: la siguiente línea sigue la lista; Enter en
            // un elemento vacío la termina.
            const prev = lineText(l - 1)
            const glyph = prev.match(GLYPH_RE)
            if (glyph && prev.length <= 2) {
                edit(() => buffer.delete(lineStart(l - 1), iterAt(l - 1, chars(prev))))
            } else if (glyph && !GLYPH_RE.test(text)) {
                edit(() => buffer.insert(lineStart(l), glyph[1] === "•" ? GLYPHS.bullet : GLYPHS.check, -1))
            }
            // Después de un título se sigue con texto normal.
            if (!text.trim() && headings.some((t) => lineStart(l).has_tag(t))) {
                setLineTags(l, lineTagsOf(lineStart(l)).filter((t) => !headings.includes(t)))
                changed = true
            }
        }
        return changed
    }

    // ─── Eventos del buffer ──────────────────────────────────────────────────

    let workId = 0
    const schedule = () => {
        if (workId) return
        workId = GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
            workId = 0
            work()
            return GLib.SOURCE_REMOVE
        })
    }
    const flush = () => {
        if (!workId) return
        GLib.source_remove(workId)
        workId = 0
        work()
    }
    function work() {
        if (autoformat()) return schedule()
        sync()
        const fold = foldTarget()
        if (fold) render(cursorTarget(), fold.keepOpen)
        else decorate()
    }
    const cursorTarget = () => {
        const it = cursorIter()
        const item = items[it.get_line()]
        return item ? { node: item.node, offset: it.get_line_offset() } : null
    }

    buffer.connect("insert-text", () => {
        inserting = true
    })
    // Lo escrito hereda los tags de la línea (nivel, título, cita) y el
    // estilo del texto de al lado, como en un procesador de texto.
    buffer.connect_after("insert-text", (_b, end: Gtk.TextIter, text: string) => {
        inserting = false
        if (rendering) return
        const start = end.copy()
        start.backward_chars(chars(text))
        const first = start.get_line()
        const last = end.get_line()

        if (!autoformatting) {
            let styles = typingStyles
            if (!styles) {
                const src = start.copy()
                const useBefore = !src.starts_line() && src.backward_char()
                const from = useBefore ? src : end
                styles = new Set(
                    (Object.entries(inline) as [InlineStyle, Gtk.TextTag][]).filter(([, t]) => from.has_tag(t) && !from.ends_line()).map(([s]) => s),
                )
            }
            for (const [style, t] of Object.entries(inline) as [InlineStyle, Gtk.TextTag][]) {
                if (styles.has(style)) buffer.apply_tag(t, start, end)
                else buffer.remove_tag(t, start, end)
            }
        }

        const lineStartIter = lineStart(first)
        let identity: Gtk.TextTag[]
        if (lineStartIter.compare(start) < 0) identity = lineTagsOf(lineStartIter)
        else if (!end.is_end()) identity = lineTagsOf(end)
        else identity = first > 0 ? lineTagsOf(lineStart(first - 1)).filter((t) => !headings.includes(t) && t !== subnoteTag) : [depthTags[0]]
        for (let l = first; l <= last; l++) setLineTags(l, identity.filter((t) => l === first || t !== subnoteTag))

        if (!autoformatting) lastInsert = { text, line: end.get_line() }
        schedule()
    })
    buffer.connect_after("delete-range", (_b, start: Gtk.TextIter) => {
        if (rendering) return
        const l = start.get_line()
        setLineTags(l, lineTagsOf(lineStart(l)))
        if (!autoformatting) lastDeleteLine = l
        schedule()
    })
    buffer.connect("notify::cursor-position", () => {
        if (rendering || inserting) return
        typingStyles = null
        schedule()
    })

    // ─── Acciones (barra y teclado) ──────────────────────────────────────────

    function applyBlock(lines: number[], block: Block) {
        for (const l of lines) {
            const tags = lineTagsOf(lineStart(l)).filter((t) => !headings.includes(t) && t !== quoteTag)
            if (block === "quote") tags.push(quoteTag)
            else if (block) tags.push(headings[block - 1])
            setLineTags(l, tags)
        }
    }

    return {
        tags: { subnote: subnoteTag },

        load() {
            path = []
            render(null)
        },

        rerender() {
            flush()
            render(cursorTarget())
        },

        // Abre la subnota de la línea `l` (si lo es).
        openAt(l: number): boolean {
            flush()
            const item = items[l]
            if (!item || item.title || !isSubnoteNode(item.node)) return false
            const chain: NoteNode[] = []
            for (let i: Item | null = item; i; i = i.parent) chain.unshift(i.node)
            path = [...path, ...chain]
            render({ node: item.node, offset: Number.MAX_SAFE_INTEGER })
            return true
        },

        back() {
            flush()
            if (!path.length) return
            const closed = path[path.length - 1]
            let i = path.length - 2
            while (i >= 0 && !isSubnoteNode(path[i])) i--
            path = path.slice(0, i + 1)
            render({ node: closed, offset: 0 })
        },

        isOpen: () => path.length > 0,

        // Clic: ¿qué hay en (x, y) de la vista? Sin texto invisible,
        // get_iter_at_location es seguro.
        hit(x: number, y: number): { kind: "subnote" | "checkbox"; line: number } | null {
            const [bx, by] = view.window_to_buffer_coords(Gtk.TextWindowType.WIDGET, x, y)
            const [ok, it] = view.get_iter_at_location(bx, by)
            if (!ok) return null
            const l = it.get_line()
            const item = items[l]
            if (!item || item.title) return null
            if (isSubnoteNode(item.node) && !item.children.length) return { kind: "subnote", line: l }
            if ((item.kind === "check" || item.kind === "checked") && it.get_line_offset() <= 1) return { kind: "checkbox", line: l }
            return null
        },

        toggleCheckbox(l: number) {
            const glyph = lineText(l)[0]
            if (glyph !== "☐" && glyph !== "☑") return
            userAction(() => {
                buffer.delete(lineStart(l), iterAt(l, 1))
                buffer.insert(lineStart(l), glyph === "☐" ? "☑" : "☐", -1)
            })
            // Que se pliegue al momento aunque el cursor esté ahí.
            flush()
            render(cursorTarget())
        },

        // Negrita, cursiva, tachado, código: sobre la selección, o para lo
        // próximo que se escriba.
        toggleInline(style: InlineStyle) {
            const t = inline[style]
            const [has, s, e] = buffer.get_selection_bounds()
            if (!has) {
                const next = new Set(typingStyles ?? stylesBefore(cursorIter()))
                if (next.has(style)) next.delete(style)
                else next.add(style)
                typingStyles = next
                return
            }
            let all = true
            for (const it = s.copy(); it.compare(e) < 0; it.forward_char()) {
                if (!it.has_tag(t) && !it.ends_line()) {
                    all = false
                    break
                }
            }
            if (all) buffer.remove_tag(t, s, e)
            else buffer.apply_tag(t, s, e)
            schedule()
        },

        setBlock(block: Block) {
            applyBlock(selectedLines(), block)
            schedule()
        },

        toggleList(kind: "bullet" | "check") {
            userAction(() => {
                for (const l of selectedLines()) {
                    const text = lineText(l)
                    const glyph = text.match(GLYPH_RE)
                    const current = glyph ? kindOfGlyph(glyph[1]) : "text"
                    const same = kind === "bullet" ? current === "bullet" : current === "check" || current === "checked"
                    if (glyph) buffer.delete(lineStart(l), iterAt(l, 2))
                    if (!same) buffer.insert(lineStart(l), GLYPHS[kind], -1)
                }
            })
        },

        // Sangría: meter o sacar líneas de la subnota de arriba.
        shiftDepth(direction: 1 | -1) {
            for (const l of selectedLines()) {
                const depth = Math.max(0, Math.min(MAX_DEPTH, depthOf(l) + direction))
                setLineTags(l, [...lineTagsOf(lineStart(l)).filter((t) => !depthTags.includes(t)), depthTags[depth]])
            }
            schedule()
        },

        // Backspace al inicio de una línea con sangría la saca un nivel.
        backspaceOutdents(): boolean {
            const [has] = buffer.get_selection_bounds()
            const it = cursorIter()
            if (has || !it.starts_line() || depthOf(it.get_line()) === 0) return false
            this.shiftDepth(-1)
            return true
        },
    }
}

export type Editor = ReturnType<typeof createEditor>
