import { Gtk, Gdk } from "ags/gtk4"
// @ts-ignore
import GObject from "gi://GObject"
// @ts-ignore
import GLib from "gi://GLib?version=2.0"
// @ts-ignore
import Gio from "gi://Gio?version=2.0"
import Mpris from "../../lib/mpris"
import { createAnalyzer, HOP, SAMPLE_RATE, SEGMENT_COUNT } from "./spectrum"

const mpris = Mpris.get_default()

// ─── Encendido / apagado manual ──────────────────────────────────────────────
// Se guarda como un archivo vacío: si existe, el visualizador está apagado y
// sigue así tras reiniciar AGS. Apagado no corre parec ni se dibuja nada.
const OFF_FILE = `${GLib.get_user_state_dir()}/shiro-ags/visualizer-off`
let enabled = !GLib.file_test(OFF_FILE, GLib.FileTest.EXISTS)
const listeners: Array<() => void> = []

export const isVisualizerEnabled = () => enabled

export function setVisualizerEnabled(on: boolean) {
    enabled = on
    try {
        if (on) Gio.File.new_for_path(OFF_FILE).delete(null)
        else {
            GLib.mkdir_with_parents(GLib.path_get_dirname(OFF_FILE), 0o755)
            GLib.file_set_contents(OFF_FILE, "")
        }
    } catch {
        // sin el archivo solo se pierde recordarlo al reiniciar
    }
    listeners.forEach((fn) => fn())
}

export function onVisualizerChanged(fn: () => void) {
    listeners.push(fn)
}

// === DISEÑO ===
const WIDTH = 30
// Cada segmento es una línea con 3,5 px de paso (1,5 px de línea + aire).
// Si la barra lateral no tiene tanto alto (pantalla de 768 px de la laptop),
// las líneas se juntan hasta MIN_PITCH en vez de empujar los controles de
// reproducción fuera de la pantalla.
const PITCH = 3.5
const MIN_PITCH = 1.5
// Con menos alto que esto no se lee: no se dibuja y el espacio queda para el
// resto de la barra (por eso el lienzo pide solo 1 px).
const MIN_VISIBLE_HEIGHT = 90
const LINE = 1.5
const MIN_HALF = 1 // media longitud en reposo
// Opacidad según el nivel: casi invisible en reposo, plena en un pico. La
// curva (>1) deja tenues los niveles bajos y medios, así resaltan más los
// fuertes.
const ALPHA_IDLE = 0.08
const ALPHA_FULL = 1
const ALPHA_CURVE = 1.8
// Puntos de pico que se quedan atrás cuando una línea baja.
const SHOW_PEAKS = false
// Línea que queda al apagarlo a mano: media longitud, opacidad y alto de su
// zona (es lo que se puede clicar para encenderlo).
const OFF_HALF = 6
const OFF_ALPHA = 0.35
const OFF_HEIGHT = 20
// Cada cuánto se revisa qué salida de audio está sonando.
const WATCH_MS = 3000
// ===============

// Lienzo que mide solo lo que dibuja: mínimo 1 px (en la pantalla baja de la
// laptop se encoge y las líneas se juntan, sin empujar los controles fuera) e
// ideal el alto de las barras. El hueco sobrante de la barra lo toman las apps.
const VisCanvas = GObject.registerClass(
    { GTypeName: "ShiroVisCanvas" },
    class VisCanvas extends Gtk.DrawingArea {
        wanted: () => number = () => 1
        vfunc_measure(orientation: Gtk.Orientation, _forSize: number): [number, number, number, number] {
            if (orientation === Gtk.Orientation.HORIZONTAL) return [WIDTH, WIDTH, -1, -1]
            return [1, Math.max(1, Math.round(this.wanted())), -1, -1]
        }
    },
)

// Visualizador de espectro de la barra lateral. El análisis está en
// spectrum.ts; aquí van la captura (parec) y el dibujo.
//
// Rendimiento: antes eran 60 Gtk.Box a las que se les cambiaba el tamaño en
// cada bloque de audio, y cada set_size_request rehacía el layout de toda la
// barra lateral (~50 % de un núcleo con música). Ahora es una sola
// DrawingArea que se repinta, y parec solo corre mientras algo suena (algún
// flujo de PipeWire sin pausar): en pausa o sin música no gasta nada.
export function MediaVisualizer() {
    const container = (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["media-visualizer"]}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.END}
        />
    ) as Gtk.Box

    let analyzer = createAnalyzer()

    // El color sale del CSS (.vis-noise-line { color }), así sigue al tema.
    const canvas = new VisCanvas({
        cssClasses: ["vis-noise-line"],
        halign: Gtk.Align.START,
    })
    canvas.wanted = () => !enabled ? OFF_HEIGHT : device ? PITCH * SEGMENT_COUNT : 1
    canvas.set_draw_func((_area: Gtk.DrawingArea, cr: any, _w: number, height: number) => {
        // Apagado a mano: una línea tenue abajo, para saber dónde hacer clic
        // para encenderlo de nuevo.
        if (!enabled) {
            const c = canvas.get_color()
            cr.setSourceRGBA(c.red, c.green, c.blue, OFF_ALPHA)
            cr.setLineWidth(LINE)
            cr.setLineCap(1) // ROUND
            cr.moveTo(WIDTH / 2 - OFF_HALF, height / 2)
            cr.lineTo(WIDTH / 2 + OFF_HALF, height / 2)
            cr.stroke()
            cr.$dispose()
            return
        }
        // Oculto si no hay espacio o si no suena nada (no hay captura).
        if (height < MIN_VISIBLE_HEIGHT || !device) {
            cr.$dispose()
            return
        }
        const c = canvas.get_color()
        const mid = WIDTH / 2
        const pitch = Math.max(MIN_PITCH, Math.min(PITCH, height / SEGMENT_COUNT))
        // Pegado abajo, junto a los controles, como antes.
        const top = height - pitch * SEGMENT_COUNT
        cr.setLineWidth(Math.min(LINE, pitch * 0.6))
        cr.setLineCap(1) // ROUND
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const level = analyzer.levels[i]
            const y = top + i * pitch + pitch / 2
            const half = MIN_HALF + level * (mid - MIN_HALF - 1)
            cr.setSourceRGBA(c.red, c.green, c.blue, c.alpha * (ALPHA_IDLE + (ALPHA_FULL - ALPHA_IDLE) * Math.pow(level, ALPHA_CURVE)))
            cr.moveTo(mid - half, y)
            cr.lineTo(mid + half, y)
            cr.stroke()

            // Marcador de pico: un punto a cada lado que cae despacio.
            const peak = analyzer.peaks[i]
            if (SHOW_PEAKS && peak > level + 0.04) {
                const p = MIN_HALF + peak * (mid - MIN_HALF - 1)
                cr.setSourceRGBA(c.red, c.green, c.blue, c.alpha * 0.85)
                cr.rectangle(mid - p - 0.75, y - 0.75, 1.5, 1.5)
                cr.rectangle(mid + p - 0.75, y - 0.75, 1.5, 1.5)
                cr.fill()
            }
        }
        cr.$dispose()
    })
    container.append(canvas)

    // Clic sobre el visualizador: apagar / encender. Todo el lienzo cuenta:
    // mide solo lo que dibuja (ver VisCanvas).
    const click = new Gtk.GestureClick()
    click.connect("released", () => setVisualizerEnabled(!enabled))
    canvas.add_controller(click)
    canvas.cursor = Gdk.Cursor.new_from_name("pointer", null)
    const syncTooltip = () => {
        canvas.tooltipText = enabled ? "Clic para apagar el visualizador" : "Clic para encender el visualizador"
    }
    syncTooltip()

    // ─── Captura ─────────────────────────────────────────────────────────────
    // El vigilante mira cada WATCH_MS si hay que capturar y de qué salida:
    // arranca parec, lo reinicia al cambiar de salida (HDMI, Bluetooth...) y
    // lo vuelve a levantar si se cae.
    let subprocess: Gio.Subprocess | null = null
    let inputStream: Gio.DataInputStream | null = null
    let device: string | null = null
    // Sube en cada arranque/parada para ignorar lecturas de un parec viejo.
    let generation = 0
    let checking = false
    let destroyed = false

    const pactl = (args: string[]) =>
        new Promise<string>((resolve) => {
            try {
                const proc = Gio.Subprocess.new(["pactl", ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE)
                proc.communicate_utf8_async(null, null, (_p: any, res: any) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res)
                        resolve(stdout ?? "")
                    } catch {
                        resolve("")
                    }
                })
            } catch {
                resolve("")
            }
        })

    // La salida donde suena algún flujo sin pausar, o null si no suena nada.
    // Se mira PipeWire y no MPRIS: el audio que llega de la otra máquina
    // (RTP), los juegos o Discord suenan sin ningún reproductor MPRIS.
    const soundingSink = async (): Promise<string | null> => {
        const inputs = await pactl(["list", "sink-inputs"])
        const sinkIds = new Set<string>()
        for (const block of inputs.split(/^Sink Input #/m)) {
            const sink = block.match(/^\s*Sink: (\d+)/m)?.[1]
            if (sink && /^\s*Corked: no/m.test(block)) sinkIds.add(sink)
        }
        if (!sinkIds.size) return null
        const sinks = (await pactl(["list", "short", "sinks"])).split("\n").map((l) => l.split("\t"))
        return sinks.find(([id]) => sinkIds.has(id))?.[1] ?? null
    }

    const stop = () => {
        generation++
        subprocess?.force_exit()
        subprocess = null
        inputStream = null
        device = null
        // Vuelta al reposo, dibujado una vez.
        analyzer = createAnalyzer()
        canvas.queue_resize()
    }

    const start = (sink: string) => {
        stop()
        const gen = generation
        device = sink
        canvas.queue_resize()
        try {
            subprocess = Gio.Subprocess.new(
                ["parec", "--format=s16le", `--rate=${SAMPLE_RATE}`, "--channels=1", "--latency-msec=30", `--device=${sink}.monitor`],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            )
        } catch (e) {
            console.error("visualizador: no se pudo lanzar parec", e)
            device = null
            return
        }
        inputStream = new Gio.DataInputStream({
            base_stream: subprocess.get_stdout_pipe()!,
            close_base_stream: true,
        })

        const readChunk = () => {
            if (gen !== generation || !inputStream) return
            inputStream.read_bytes_async(HOP * 2, GLib.PRIORITY_DEFAULT, null, (source: any, res: any) => {
                if (gen !== generation) return
                try {
                    const bytes = source?.read_bytes_finish(res)
                    // parec terminó: el vigilante lo vuelve a lanzar.
                    if (!bytes || bytes.get_size() === 0) return stop()
                    const data = bytes.get_data()!
                    // Vista directa sobre los bytes (s16le); copia solo si
                    // vienen desalineados.
                    const pcm = data.byteOffset % 2 === 0
                        ? new Int16Array(data.buffer, data.byteOffset, data.byteLength >> 1)
                        : new Int16Array(data.slice().buffer)
                    if (analyzer.push(pcm)) canvas.queue_draw()
                    readChunk()
                } catch (e) {
                    console.error("visualizador: error leyendo audio", e)
                    stop()
                }
            })
        }
        readChunk()
    }

    const check = async () => {
        if (checking || destroyed) return
        if (!enabled) {
            if (device) stop()
            return
        }
        checking = true
        try {
            const sink = await soundingSink()
            if (destroyed) return
            if (!sink) {
                if (device) stop()
            } else if (sink !== device) start(sink)
        } finally {
            checking = false
        }
    }

    // Play/pausa de un reproductor MPRIS se nota al momento; lo demás, en el
    // vigilante.
    const watched = new Set<object>()
    const watchPlayers = () => {
        for (const player of mpris.players) {
            if (watched.has(player)) continue
            watched.add(player)
            player.connect("notify::playback-status", () => check())
        }
        check()
    }
    onVisualizerChanged(() => { syncTooltip(); canvas.queue_resize(); check() })
    const playersId = mpris.connect("notify::players", watchPlayers)
    watchPlayers()

    const watchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCH_MS, () => {
        check()
        return GLib.SOURCE_CONTINUE
    })

    container.connect("destroy", () => {
        destroyed = true
        GLib.source_remove(watchId)
        mpris.disconnect(playersId)
        stop()
    })

    return container
}
