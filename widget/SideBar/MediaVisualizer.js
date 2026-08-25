import { jsx as _jsx } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
// @ts-ignore
import GLib from "gi://GLib?version=2.0";
// @ts-ignore
import Gio from "gi://Gio?version=2.0";
const MAX_WIDTH = 30;
const FFT_SIZE = 2048;
const SAMPLE_RATE = 44100;
const SEGMENT_COUNT = 60;
// === CONFIGURACIÓN ===
const SENSITIVITY = 13;
// Multiplicadores por bandas
const MULT_SUB_BASS = 0.1;
const MULT_BASS = 0.1;
const MULT_LOW_MIDS = 0.2;
const MULT_MIDS = 0.6;
const MULT_HIGH_MIDS = 1;
const MULT_TREBLE = 1.5;
const MULTIPLIERS = [
    MULT_SUB_BASS,
    MULT_BASS,
    MULT_LOW_MIDS,
    MULT_MIDS,
    MULT_HIGH_MIDS,
    MULT_TREBLE
];
// Rango de frecuencias
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
// Suavizado
const ATTACK_SMOOTH = 1;
const DECAY_SMOOTH = 0.6;
const SPATIAL_SMOOTH = 2;
// ====================
// FFT simple
function fft(input) {
    const n = input.length;
    if (n & (n - 1))
        return input.map(v => ({ real: v, imag: 0 }));
    if (n <= 1)
        return input.map(v => ({ real: v, imag: 0 }));
    const even = fft(input.filter((_, i) => i % 2 === 0));
    const odd = fft(input.filter((_, i) => i % 2 !== 0));
    const result = new Array(n).fill(0).map(() => ({ real: 0, imag: 0 }));
    const halfN = n / 2;
    for (let k = 0; k < halfN; k++) {
        const angle = -2 * Math.PI * k / n;
        const tReal = Math.cos(angle) * odd[k].real - Math.sin(angle) * odd[k].imag;
        const tImag = Math.cos(angle) * odd[k].imag + Math.sin(angle) * odd[k].real;
        result[k] = { real: even[k].real + tReal, imag: even[k].imag + tImag };
        result[k + halfN] = { real: even[k].real - tReal, imag: even[k].imag - tImag };
    }
    return result;
}
function frequencyToBin(freq) {
    return Math.floor((freq * FFT_SIZE) / SAMPLE_RATE);
}
export function MediaVisualizer() {
    const container = (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["media-visualizer"], halign: Gtk.Align.CENTER, valign: Gtk.Align.END, vexpand: true }));
    const lineBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        halign: Gtk.Align.START,
        valign: Gtk.Align.END
    });
    lineBox.add_css_class("vis-noise-line");
    const segments = [];
    const lastWidth = new Array(SEGMENT_COUNT).fill(2);
    for (let i = 0; i < SEGMENT_COUNT; i++) {
        const seg = new Gtk.Box();
        seg.add_css_class("vis-noise-seg");
        seg.set_size_request(2, 1);
        seg.set_halign(Gtk.Align.START);
        lineBox.append(seg);
        segments.push(seg);
    }
    container.append(lineBox);
    let subprocess = null;
    let inputStream = null;
    const updateVisualizer = (data) => {
        if (data.length !== FFT_SIZE)
            return;
        const spectrum = fft(data);
        // 1. Calcular anchos crudos para cada segmento
        const rawTargetWidths = new Array(SEGMENT_COUNT).fill(0);
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const visIndex = (SEGMENT_COUNT - 1) - i;
            const totalPos = visIndex / (SEGMENT_COUNT - 1);
            const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, totalPos);
            const bandIdx = Math.floor(visIndex / 10);
            const multiplier = MULTIPLIERS[bandIdx] || 1.0;
            const bin = frequencyToBin(freq);
            if (bin < spectrum.length) {
                const s = spectrum[bin];
                const mag = Math.sqrt(s.real ** 2 + s.imag ** 2);
                rawTargetWidths[i] = Math.min(mag * SENSITIVITY * multiplier, MAX_WIDTH);
            }
        }
        // 2. Aplicar suavizado espacial (Box Blur) y luego temporal
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            let sum = 0;
            let count = 0;
            for (let j = -SPATIAL_SMOOTH; j <= SPATIAL_SMOOTH; j++) {
                const neighborIdx = i + j;
                if (neighborIdx >= 0 && neighborIdx < SEGMENT_COUNT) {
                    sum += rawTargetWidths[neighborIdx];
                    count++;
                }
            }
            const spatialTargetWidth = sum / count;
            // Suavizado temporal
            const currentWidth = lastWidth[i];
            const smoothedWidth = spatialTargetWidth > currentWidth
                ? currentWidth + (spatialTargetWidth - currentWidth) * ATTACK_SMOOTH
                : currentWidth + (spatialTargetWidth - currentWidth) * DECAY_SMOOTH;
            lastWidth[i] = smoothedWidth;
            segments[i].set_size_request(Math.max(2, Math.floor(smoothedWidth)), 1);
        }
    };
    const startVisualizer = () => {
        try {
            const [ok, stdout] = GLib.spawn_command_line_sync("pactl list short sinks");
            if (!ok)
                return console.error("No se pudieron listar sinks");
            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(stdout).split("\n");
            let activeSink = lines.find(l => l.includes("RUNNING"))?.split("\t")[1] ?? "";
            if (!activeSink) {
                const [ok2, defOut] = GLib.spawn_command_line_sync("pactl get-default-sink");
                if (ok2)
                    activeSink = decoder.decode(defOut).trim();
            }
            if (!activeSink)
                return console.error("No se encontró sink activo");
            const device = activeSink + ".monitor";
            console.log(`=== VISUALIZADOR DE ONDAS ===`);
            console.log(`Rango: ${MIN_FREQ}Hz - ${MAX_FREQ}Hz`);
            console.log(`Multiplicadores: ${MULTIPLIERS.join(", ")}`);
            console.log(`Smoothing: A=${ATTACK_SMOOTH}, D=${DECAY_SMOOTH}, S=${SPATIAL_SMOOTH}`);
            subprocess = Gio.Subprocess.new(["parec", "--format=s16le", "--rate=44100", "--channels=1", "--latency=512", "--device=" + device], Gio.SubprocessFlags.STDOUT_PIPE);
            inputStream = new Gio.DataInputStream({
                base_stream: subprocess.get_stdout_pipe(),
                close_base_stream: true
            });
            const readChunk = () => {
                if (!inputStream)
                    return GLib.SOURCE_REMOVE;
                inputStream.read_bytes_async(FFT_SIZE * 2, GLib.PRIORITY_DEFAULT, null, (source, res) => {
                    try {
                        const bytes = source?.read_bytes_finish(res);
                        if (!bytes || bytes.get_size() === 0)
                            return;
                        const uint8Data = bytes.get_data();
                        if (!uint8Data || uint8Data.length === 0)
                            return;
                        const buffer = uint8Data.buffer.slice(uint8Data.byteOffset, uint8Data.byteOffset + uint8Data.byteLength);
                        const int16Buffer = new Int16Array(buffer);
                        const samples = new Array(FFT_SIZE).fill(0);
                        for (let i = 0; i < Math.min(int16Buffer.length, FFT_SIZE); i++) {
                            samples[i] = int16Buffer[i] / 32768.0;
                        }
                        updateVisualizer(samples);
                        readChunk();
                    }
                    catch (e) {
                        console.error("Error:", e);
                    }
                });
                return GLib.SOURCE_REMOVE;
            };
            readChunk();
        }
        catch (e) {
            console.error("Error iniciando:", e);
        }
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        startVisualizer();
        return GLib.SOURCE_REMOVE;
    });
    container.connect("destroy", () => {
        subprocess?.force_exit();
    });
    return container;
}
