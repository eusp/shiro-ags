import { Gtk, Gdk } from "ags/gtk4"
import Graphene from "gi://Graphene"
import Mpris from "../../lib/mpris"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"

const mpris = Mpris.get_default()

// Cuánto hay que quedarse sobre el play para que salga el panel, y cuánto
// espera para cerrarse al salir (lo justo para pasar del botón al panel).
const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 250
const COVER_SIZE = 120
const COVER_CACHE = `${GLib.get_user_cache_dir()}/shiro-ags/covers`

// spotify-launcher es el paquete oficial de Arch (lo que hay instalado);
// los otros quedan por si Spotify viene de otro lado.
const SPOTIFY_COMMANDS = [["spotify-launcher"], ["spotify"], ["flatpak", "run", "com.spotify.Client"]]

function launchSpotify() {
    for (const argv of SPOTIFY_COMMANDS) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE)
            return
        } catch {
            // No está instalado así: probar el siguiente.
        }
    }
}

const formatTime = (us: number) => {
    const total = Math.max(0, Math.floor(us / 1e6))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

// Portada: las locales (file://, como las de Firefox) se usan tal cual; las
// remotas (Spotify) se bajan una vez con curl a la caché.
function loadCover(url: string, done: (path: string | null) => void) {
    if (!url) return done(null)
    if (url.startsWith("file://")) return done(Gio.File.new_for_uri(url).get_path())
    if (!/^https?:\/\//.test(url)) return done(null)

    GLib.mkdir_with_parents(COVER_CACHE, 0o755)
    const path = `${COVER_CACHE}/${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)}`
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) return done(path)
    try {
        const proc = Gio.Subprocess.new(["curl", "-sfL", "--max-time", "10", "-o", path, url], Gio.SubprocessFlags.NONE)
        proc.wait_check_async(null, (_p: any, res: any) => {
            try {
                proc.wait_check_finish(res)
                done(path)
            } catch {
                done(null)
            }
        })
    } catch {
        done(null)
    }
}

// Panel de reproducción: sale de la barra lateral como los menús de clic
// derecho de las apps (mismo popover, pegado al borde).
function MediaPopover(anchor: Gtk.Widget) {
    let player: any = null
    let progressId = 0
    let coverUrl = ""

    // Gtk.Image y no Gtk.Picture: Picture pide el tamaño natural de la imagen
    // (las portadas de Spotify son de 640 px) y el panel quedaba enorme.
    const cover = new Gtk.Image({
        cssClasses: ["media-popover-cover"],
        pixelSize: COVER_SIZE,
        overflow: Gtk.Overflow.HIDDEN,
    })
    const coverFallback = new Gtk.Image({
        iconName: "audio-x-generic-symbolic",
        pixelSize: 40,
        cssClasses: ["media-popover-cover-fallback"],
        widthRequest: COVER_SIZE,
        heightRequest: COVER_SIZE,
    })
    const coverStack = new Gtk.Stack({ halign: Gtk.Align.CENTER })
    coverStack.add_named(cover, "cover")
    coverStack.add_named(coverFallback, "fallback")
    coverStack.visibleChildName = "fallback"

    const title = new Gtk.Label({ cssClasses: ["media-popover-title"], xalign: 0, wrap: true, maxWidthChars: 16, widthChars: 16, lines: 2, ellipsize: 3 })
    const artist = new Gtk.Label({ cssClasses: ["media-popover-artist"], xalign: 0, ellipsize: 3, maxWidthChars: 18 })

    const progress = new Gtk.ProgressBar({ cssClasses: ["media-popover-progress"] })
    const elapsed = new Gtk.Label({ cssClasses: ["media-popover-time"], xalign: 0, hexpand: true })
    const duration = new Gtk.Label({ cssClasses: ["media-popover-time"], xalign: 1 })
    const times = new Gtk.Box()
    times.append(elapsed)
    times.append(duration)
    const progressBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    progressBox.append(progress)
    progressBox.append(times)

    const control = (icon: string, onClick: () => void) => {
        const btn = new Gtk.Button({ cssClasses: ["media-popover-btn"] })
        btn.set_child(new Gtk.Image({ iconName: icon }))
        btn.connect("clicked", onClick)
        return btn
    }
    const playIcon = new Gtk.Image()
    const playBtn = new Gtk.Button({ cssClasses: ["media-popover-btn", "media-popover-play"] })
    playBtn.set_child(playIcon)
    playBtn.connect("clicked", () => player?.play_pause())
    const controls = new Gtk.Box({ halign: Gtk.Align.CENTER, spacing: 6 })
    controls.append(control("media-skip-backward-symbolic", () => player?.previous()))
    controls.append(playBtn)
    controls.append(control("media-skip-forward-symbolic", () => player?.next()))

    // En horizontal: portada a la izquierda y todo lo demás a su lado, así el
    // panel mide poco más que la portada de alto.
    const info = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, valign: Gtk.Align.CENTER })
    info.append(title)
    info.append(artist)
    info.append(progressBox)
    info.append(controls)
    const content = new Gtk.Box({ spacing: 10, cssClasses: ["media-popover-content"] })
    coverStack.valign = Gtk.Align.CENTER
    content.append(coverStack)
    content.append(info)

    const popover = new Gtk.Popover({
        cssClasses: ["shared-popover", "edge-left", "media-popover"],
        hasArrow: false,
        // Sin autohide: abrirlo con el mouse no debe robar el teclado ni
        // obligar a hacer clic afuera para cerrarlo.
        autohide: false,
        position: Gtk.PositionType.RIGHT,
        child: content,
    })
    popover.set_parent(anchor)

    const refreshProgress = async () => {
        if (!player) return
        const length = player.length
        const position = length ? await player.position() : 0
        progressBox.visible = length > 0
        progress.fraction = length ? Math.min(1, position / length) : 0
        elapsed.label = formatTime(position)
        duration.label = formatTime(length)
    }

    const refresh = () => {
        if (!player) return
        title.label = player.title || "Sin título"
        artist.label = player.artist
        artist.visible = !!player.artist
        playIcon.iconName = player.playbackStatus === Mpris.PlaybackStatus.PLAYING ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"
        if (player.artUrl !== coverUrl) {
            coverUrl = player.artUrl
            const wanted = coverUrl
            coverStack.visibleChildName = "fallback"
            loadCover(wanted, (path) => {
                if (wanted !== coverUrl || !path) return
                cover.set_from_file(path)
                coverStack.visibleChildName = "cover"
            })
        }
        refreshProgress()
    }

    popover.connect("notify::visible", () => {
        if (progressId) GLib.source_remove(progressId)
        progressId = 0
        if (!popover.visible) return
        refresh()
        progressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            refreshProgress()
            return GLib.SOURCE_CONTINUE
        })
    })

    return {
        popover,
        setPlayer(p: any) {
            player = p
            if (popover.visible) refresh()
        },
        refresh,
    }
}

// Barra lateral: solo el play. Al quedarse encima sale el panel con la
// portada, el título y los controles; el clic sigue siendo play/pausa.
export function MediaControls() {
    const sep = new Gtk.Box({ cssClasses: ["sidebar-separator"] })
    const playIcon = new Gtk.Image({ iconName: "media-playback-start-symbolic" })
    const playBtn = new Gtk.Button({ cssClasses: ["media-play-btn"], halign: Gtk.Align.CENTER })
    playBtn.set_child(playIcon)

    const container = (
        <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["media-controls"]} spacing={6} hexpand={false} />
    ) as Gtk.Box
    container.append(sep)
    container.append(playBtn)

    const panel = MediaPopover(playBtn)
    let player: any = null
    let playerSignals: number[] = []

    const hasMedia = () => !!player && !!player.title && player.playbackStatus !== Mpris.PlaybackStatus.STOPPED

    const update = () => {
        const next = mpris.players[0] ?? null
        if (next !== player) {
            for (const id of playerSignals) player?.disconnect(id)
            player = next
            playerSignals = player
                ? ["notify::playback-status", "notify::title", "notify::artist", "notify::art-url"].map((sig) =>
                      player.connect(sig, update),
                  )
                : []
            panel.setPlayer(player)
        }

        const media = hasMedia()
        container.opacity = media ? 1 : 0.3
        playIcon.iconName = media && player.playbackStatus === Mpris.PlaybackStatus.PLAYING
            ? "media-playback-pause-symbolic"
            : "media-playback-start-symbolic"
        playBtn.tooltipText = media ? "" : "Abrir Spotify"
        if (!media) panel.popover.popdown()
        else if (panel.popover.visible) panel.refresh()
    }

    playBtn.connect("clicked", () => (hasMedia() ? player.play_pause() : launchSpotify()))

    // El play está centrado y más angosto que la barra: si el panel apunta al
    // botón, sale por encima de la barra. Se apunta al borde derecho de la
    // ventana de la barra, como los menús de clic derecho de las apps.
    const aimAtSidebarEdge = () => {
        const root = playBtn.get_root() as unknown as Gtk.Widget | null
        if (!root) return
        const [ok, origin] = playBtn.compute_point(root, new Graphene.Point({ x: 0, y: 0 }))
        if (!ok) return
        const edge = Math.round(root.get_width() - origin.x)
        panel.popover.set_pointing_to(new Gdk.Rectangle({ x: edge - 1, y: 0, width: 1, height: playBtn.get_height() }))
    }

    // Abrir/cerrar al pasar el mouse por el botón o por el panel.
    let openId = 0
    let closeId = 0
    const clear = (id: number) => id && GLib.source_remove(id)
    const scheduleOpen = () => {
        clear(closeId)
        closeId = 0
        if (openId || panel.popover.visible || !hasMedia()) return
        openId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, OPEN_DELAY_MS, () => {
            openId = 0
            if (hasMedia()) {
                aimAtSidebarEdge()
                panel.popover.popup()
            }
            return GLib.SOURCE_REMOVE
        })
    }
    const scheduleClose = () => {
        clear(openId)
        openId = 0
        if (closeId) return
        closeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOSE_DELAY_MS, () => {
            closeId = 0
            panel.popover.popdown()
            return GLib.SOURCE_REMOVE
        })
    }
    for (const widget of [playBtn, panel.popover]) {
        const motion = new Gtk.EventControllerMotion()
        motion.connect("enter", scheduleOpen)
        motion.connect("leave", scheduleClose)
        widget.add_controller(motion)
    }

    mpris.connect("notify::players", update)
    update()

    return container
}
