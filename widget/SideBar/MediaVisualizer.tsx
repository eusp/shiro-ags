import { Gtk } from "ags/gtk4"
// @ts-ignore
import GLib from "gi://GLib?version=2.0"
// @ts-ignore
import Gio from "gi://Gio?version=2.0"

const MAX_WIDTH = 30
const FFT_SIZE = 2048
const SAMPLE_RATE = 44100
const SEGMENT_COUNT = 60

// === CONFIGURACIÓN ===
const SENSITIVITY = 13

// Multiplicadores por bandas
const MULT_SUB_BASS = 0.1
const MULT_BASS = 0.1
const MULT_LOW_MIDS = 0.2
const MULT_MIDS = 0.6
const MULT_HIGH_MIDS = 1
const MULT_TREBLE = 1.5

const MULTIPLIERS = [
    MULT_SUB_BASS,
    MULT_BASS,
    MULT_LOW_MIDS,
    MULT_MIDS,
    MULT_HIGH_MIDS,
    MULT_TREBLE
]

// Rango de frecuencias
const MIN_FREQ = 20
const MAX_FREQ = 20000

// Suavizado
const ATTACK_SMOOTH = 1
const DECAY_SMOOTH = 0.6
const SPATIAL_SMOOTH = 2

// Por debajo de este RMS se considera silencio: nos saltamos la FFT (que es
// lo caro) y solo aplicamos un decaimiento liviano hacia el mínimo. El
// pipeline de parec sigue corriendo siempre, pero la mayor parte del tiempo
// no hay audio real sonando, así que esto evita gastar CPU en una FFT de
// 2048 puntos sobre silencio.
const SILENCE_RMS_THRESHOLD = 0.003
// Cada cuánto se revisa qué salida de audio está sonando.
const WATCH_MS = 3000
// ====================

// FFT simple
function fft(input: number[]): { real: number, imag: number }[] {
    const n = input.length
    if (n & (n - 1)) return input.map(v => ({ real: v, imag: 0 }))
    if (n <= 1) return input.map(v => ({ real: v, imag: 0 }))

    const even = fft(input.filter((_, i) => i % 2 === 0))
    const odd = fft(input.filter((_, i) => i % 2 !== 0))
    const result = new Array(n).fill(0).map(() => ({ real: 0, imag: 0 }))
    const halfN = n / 2

    for (let k = 0; k < halfN; k++) {
        const angle = -2 * Math.PI * k / n
        const tReal = Math.cos(angle) * odd[k].real - Math.sin(angle) * odd[k].imag
        const tImag = Math.cos(angle) * odd[k].imag + Math.sin(angle) * odd[k].real
        result[k] = { real: even[k].real + tReal, imag: even[k].imag + tImag }
        result[k + halfN] = { real: even[k].real - tReal, imag: even[k].imag - tImag }
    }
    return result
}

function frequencyToBin(freq: number): number {
    return Math.floor((freq * FFT_SIZE) / SAMPLE_RATE)
}

export function MediaVisualizer() {
    const container = (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["media-visualizer"]}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.END}
            vexpand
        />
    ) as Gtk.Box

    const lineBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        halign: Gtk.Align.START,
        valign: Gtk.Align.END
    })
    lineBox.add_css_class("vis-noise-line")

    const segments: Gtk.Box[] = []
    const lastWidth: number[] = new Array(SEGMENT_COUNT).fill(2)

    for (let i = 0; i < SEGMENT_COUNT; i++) {
        const seg = new Gtk.Box()
        seg.add_css_class("vis-noise-seg")
        seg.set_size_request(2, 1)
        seg.set_halign(Gtk.Align.START)
        lineBox.append(seg)
        segments.push(seg)
    }

    container.append(lineBox)

    // Captura con parec del monitor de la salida de audio. Un vigilante cada
    // WATCH_MS mira qué salida está sonando: arranca la captura cuando hay
    // una, la reinicia si se cambia de salida (HDMI, Bluetooth...) y la
    // vuelve a levantar si parec se cae. Antes se buscaba la salida una sola
    // vez al arrancar el shell y, si todavía no había ninguna, el
    // visualizador se quedaba muerto.
    let subprocess: Gio.Subprocess | null = null
    let inputStream: Gio.DataInputStream | null = null
    let device: string | null = null
    // Sube en cada arranque/parada para ignorar lecturas de un parec viejo.
    let generation = 0
    let checking = false
    let destroyed = false

    const decayToSilence = () => {
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const currentWidth = lastWidth[i]
            const smoothedWidth = currentWidth + (2 - currentWidth) * DECAY_SMOOTH
            lastWidth[i] = smoothedWidth
            segments[i].set_size_request(Math.max(2, Math.floor(smoothedWidth)), 1)
        }
    }

    const updateVisualizer = (data: number[]) => {
        if (data.length !== FFT_SIZE) return

        let sumSquares = 0
        for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i]
        const rms = Math.sqrt(sumSquares / data.length)

        if (rms < SILENCE_RMS_THRESHOLD) {
            decayToSilence()
            return
        }

        const spectrum = fft(data)

        // 1. Calcular anchos crudos para cada segmento
        const rawTargetWidths = new Array(SEGMENT_COUNT).fill(0)
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const visIndex = (SEGMENT_COUNT - 1) - i
            const totalPos = visIndex / (SEGMENT_COUNT - 1)
            const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, totalPos)
            const bandIdx = Math.floor(visIndex / 10)
            const multiplier = MULTIPLIERS[bandIdx] || 1.0
            const bin = frequencyToBin(freq)

            if (bin < spectrum.length) {
                const s = spectrum[bin]
                const mag = Math.sqrt(s.real ** 2 + s.imag ** 2)
                rawTargetWidths[i] = Math.min(mag * SENSITIVITY * multiplier, MAX_WIDTH)
            }
        }

        // 2. Aplicar suavizado espacial (Box Blur) y luego temporal
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            let sum = 0
            let count = 0
            for (let j = -SPATIAL_SMOOTH; j <= SPATIAL_SMOOTH; j++) {
                const neighborIdx = i + j
                if (neighborIdx >= 0 && neighborIdx < SEGMENT_COUNT) {
                    sum += rawTargetWidths[neighborIdx]
                    count++
                }
            }
            const spatialTargetWidth = sum / count

            // Suavizado temporal
            const currentWidth = lastWidth[i]
            const smoothedWidth = spatialTargetWidth > currentWidth
                ? currentWidth + (spatialTargetWidth - currentWidth) * ATTACK_SMOOTH
                : currentWidth + (spatialTargetWidth - currentWidth) * DECAY_SMOOTH

            lastWidth[i] = smoothedWidth
            segments[i].set_size_request(Math.max(2, Math.floor(smoothedWidth)), 1)
        }
    }

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

    // La salida que está sonando; si ninguna, la predeterminada.
    const pickSink = async (): Promise<string | null> => {
        const sinks = await pactl(["list", "short", "sinks"])
        const running = sinks.split("\n").find((l) => l.includes("RUNNING"))?.split("\t")[1]
        if (running) return running
        return (await pactl(["get-default-sink"])).trim() || null
    }

    const stop = () => {
        generation++
        subprocess?.force_exit()
        subprocess = null
        inputStream = null
        device = null
    }

    const start = (sink: string) => {
        stop()
        const gen = generation
        device = sink
        try {
            subprocess = Gio.Subprocess.new(
                ["parec", "--format=s16le", `--rate=${SAMPLE_RATE}`, "--channels=1", "--latency=512", `--device=${sink}.monitor`],
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
            inputStream.read_bytes_async(FFT_SIZE * 2, GLib.PRIORITY_DEFAULT, null, (source: any, res: any) => {
                if (gen !== generation) return
                try {
                    const bytes = source?.read_bytes_finish(res)
                    // parec terminó: el vigilante lo vuelve a lanzar.
                    if (!bytes || bytes.get_size() === 0) {
                        stop()
                        decayToSilence()
                        return
                    }
                    const uint8Data = bytes.get_data()
                    const int16Buffer = new Int16Array(
                        uint8Data.buffer.slice(uint8Data.byteOffset, uint8Data.byteOffset + uint8Data.byteLength),
                    )
                    const samples = new Array(FFT_SIZE).fill(0)
                    for (let i = 0; i < Math.min(int16Buffer.length, FFT_SIZE); i++) {
                        samples[i] = int16Buffer[i] / 32768.0
                    }
                    updateVisualizer(samples)
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
        checking = true
        try {
            const sink = await pickSink()
            if (destroyed) return
            if (!sink) stop()
            else if (sink !== device) start(sink)
        } finally {
            checking = false
        }
    }

    check()
    const watchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCH_MS, () => {
        check()
        return GLib.SOURCE_CONTINUE
    })

    container.connect("destroy", () => {
        destroyed = true
        GLib.source_remove(watchId)
        stop()
    })

    return container
}