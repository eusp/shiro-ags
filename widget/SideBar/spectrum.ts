// Análisis de audio del visualizador: de muestras PCM a un nivel 0..1 por
// segmento. Sin GTK, para poder probarlo aparte con audio sintético.
//
// Por qué así (antes un piano se veía casi igual nota a nota):
// - Ventana de 4096 muestras (~10,8 Hz por bin; antes 21,5 Hz, y alrededor
//   de 220 Hz un semitono son 13 Hz: dos notas vecinas caían en el mismo bin)
//   con ventana de Hann, para que la energía de una nota no se desparrame.
// - Cada segmento toma el pico de su banda de frecuencias, no un solo bin.
// - Niveles en dB con ganancia automática: se adapta al volumen de lo que
//   suena. Antes los graves y medios (donde están las fundamentales) se
//   multiplicaban por 0,1-0,2 y los agudos por 1,5.
// - Sin suavizado entre segmentos (mezclaba unos 10 semitonos).

export const SAMPLE_RATE = 44100
export const SEGMENT_COUNT = 60
const WINDOW = 4096
// Muestras nuevas por cuadro: ~40 cuadros por segundo.
export const HOP = 1102

// Simétrico (en escala log) alrededor de ~630 Hz, el centro de la voz
// (de ~100 Hz a ~4 kHz): la voz queda en las líneas del medio.
const MIN_FREQ = 40
const MAX_FREQ = 10000
// La música pierde energía hacia los agudos (~3 dB por octava): se compensa.
const TILT_DB_PER_OCTAVE = 3
// Rango que va de vacío a lleno, por debajo del pico reciente.
const RANGE_DB = 42
// Qué tan rápido baja la ganancia automática cuando la música baja (dB/cuadro).
const AGC_RELEASE_DB = 0.12
// Por debajo de esto (RMS) es silencio: no se calcula la FFT.
const SILENCE_RMS = 0.002

const ATTACK = 0.9
const DECAY = 0.5
const PEAK_FALL = 0.012

// ─── FFT radix-2 iterativa sobre arreglos fijos ──────────────────────────────

const BITS = Math.log2(WINDOW)
const BIT_REVERSE = new Uint16Array(WINDOW)
for (let i = 0; i < WINDOW; i++) {
    let r = 0
    for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b)
    BIT_REVERSE[i] = r
}
const COS = new Float64Array(WINDOW / 2)
const SIN = new Float64Array(WINDOW / 2)
for (let k = 0; k < WINDOW / 2; k++) {
    COS[k] = Math.cos((-2 * Math.PI * k) / WINDOW)
    SIN[k] = Math.sin((-2 * Math.PI * k) / WINDOW)
}
const HANN = new Float64Array(WINDOW)
for (let i = 0; i < WINDOW; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1))

function fft(re: Float64Array, im: Float64Array) {
    for (let size = 2; size <= WINDOW; size <<= 1) {
        const half = size >> 1
        const step = WINDOW / size
        for (let start = 0; start < WINDOW; start += size) {
            for (let k = 0; k < half; k++) {
                const c = COS[k * step]
                const s = SIN[k * step]
                const a = start + k
                const b = a + half
                const tr = c * re[b] - s * im[b]
                const ti = c * im[b] + s * re[b]
                re[b] = re[a] - tr
                im[b] = im[a] - ti
                re[a] += tr
                im[a] += ti
            }
        }
    }
}

// ─── Bandas: segmento 0 = agudos (arriba), el último = graves ────────────────

const BIN_HZ = SAMPLE_RATE / WINDOW
const BAND_LO = new Float64Array(SEGMENT_COUNT) // en bins, con decimales
const BAND_HI = new Float64Array(SEGMENT_COUNT)
const BAND_TILT = new Float64Array(SEGMENT_COUNT)
for (let i = 0; i < SEGMENT_COUNT; i++) {
    const pos = SEGMENT_COUNT - 1 - i
    const edge = (p: number) => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, p / SEGMENT_COUNT)
    const lo = edge(pos)
    const hi = edge(pos + 1)
    BAND_LO[i] = lo / BIN_HZ
    BAND_HI[i] = hi / BIN_HZ
    BAND_TILT[i] = TILT_DB_PER_OCTAVE * Math.log2(Math.sqrt(lo * hi) / 1000)
}

export interface Analyzer {
    levels: Float64Array // 0..1 por segmento, suavizado
    peaks: Float64Array // marcadores de pico que caen despacio
    // Agrega muestras; devuelve true si cambió algo que dibujar.
    push(pcm: Int16Array): boolean
}

export function createAnalyzer(): Analyzer {
    const ring = new Float64Array(WINDOW)
    let write = 0
    let pending = 0
    const re = new Float64Array(WINDOW)
    const im = new Float64Array(WINDOW)
    const power = new Float64Array(WINDOW / 2)
    const target = new Float64Array(SEGMENT_COUNT)
    const levels = new Float64Array(SEGMENT_COUNT)
    const peaks = new Float64Array(SEGMENT_COUNT)
    let reference = -Infinity

    const bandPower = (i: number) => {
        const lo = BAND_LO[i]
        const hi = BAND_HI[i]
        const first = Math.ceil(lo)
        const last = Math.floor(hi)
        if (last >= first) {
            let max = 0
            for (let b = first; b <= Math.min(last, power.length - 1); b++) if (power[b] > max) max = power[b]
            return max
        }
        // Banda más angosta que un bin (graves): interpolar en su centro.
        const center = (lo + hi) / 2
        const b = Math.floor(center)
        const t = center - b
        return power[b] * (1 - t) + power[Math.min(b + 1, power.length - 1)] * t
    }

    const frame = (): boolean => {
        let sum = 0
        for (let i = 0; i < WINDOW; i++) {
            const v = ring[(write + i) % WINDOW]
            sum += v * v
            re[i] = 0
            im[i] = 0
        }
        if (Math.sqrt(sum / WINDOW) < SILENCE_RMS) {
            target.fill(0)
        } else {
            for (let i = 0; i < WINDOW; i++) re[BIT_REVERSE[i]] = ring[(write + i) % WINDOW] * HANN[i]
            fft(re, im)
            for (let b = 0; b < power.length; b++) power[b] = re[b] * re[b] + im[b] * im[b]

            let frameMax = -Infinity
            for (let i = 0; i < SEGMENT_COUNT; i++) {
                const db = 10 * Math.log10(bandPower(i) + 1e-12) + BAND_TILT[i]
                target[i] = db
                if (db > frameMax) frameMax = db
            }
            reference = Math.max(frameMax, reference - AGC_RELEASE_DB)
            const floor = reference - RANGE_DB
            for (let i = 0; i < SEGMENT_COUNT; i++) target[i] = Math.min(1, Math.max(0, (target[i] - floor) / RANGE_DB))
        }

        let changed = false
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const prev = levels[i]
            const next = prev + (target[i] - prev) * (target[i] > prev ? ATTACK : DECAY)
            levels[i] = next < 0.002 ? 0 : next
            const peak = Math.max(levels[i], peaks[i] - PEAK_FALL)
            peaks[i] = peak < 0.002 ? 0 : peak
            if (levels[i] !== prev || peaks[i] !== 0) changed = true
        }
        return changed
    }

    return {
        levels,
        peaks,
        push(pcm) {
            let changed = false
            for (let i = 0; i < pcm.length; i++) {
                ring[write] = pcm[i] / 32768
                write = (write + 1) % WINDOW
                if (++pending >= HOP) {
                    pending = 0
                    if (frame()) changed = true
                }
            }
            return changed
        },
    }
}
