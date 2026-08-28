import { jsx as _jsx } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import Mpris from "../../lib/mpris";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
const mpris = Mpris.get_default();
function launchSpotify() {
    try {
        new Gio.Subprocess({
            argv: ["flatpak", "run", "com.spotify.Client"],
            flags: Gio.SubprocessFlags.NONE,
        }).init(null);
    }
    catch {
        new Gio.Subprocess({
            argv: ["spotify"],
            flags: Gio.SubprocessFlags.NONE,
        }).init(null);
    }
}
export function MediaControls() {
    const sep = () => new Gtk.Box({ cssClasses: ["sidebar-separator"] });
    const container = (_jsx("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["media-controls"], spacing: 6, hexpand: false }));
    let currentPlayer = null;
    let lastKey = "";
    const signals = new Map();
    const update = () => {
        const player = mpris.players[0];
        if (player !== currentPlayer) {
            if (currentPlayer) {
                if (signals.has("playback-status"))
                    currentPlayer.disconnect(signals.get("playback-status"));
                if (signals.has("title"))
                    currentPlayer.disconnect(signals.get("title"));
            }
            currentPlayer = player;
            signals.clear();
            if (currentPlayer) {
                signals.set("playback-status", currentPlayer.connect("notify::playback-status", update));
                signals.set("title", currentPlayer.connect("notify::title", update));
            }
        }
        const hasMedia = !!player
            && !!player.title
            && player.playbackStatus !== Mpris.PlaybackStatus.STOPPED;
        const key = hasMedia ? `${player.title}|${player.playbackStatus}` : "idle";
        if (key === lastKey)
            return;
        lastKey = key;
        while (container.get_first_child())
            container.remove(container.get_first_child());
        if (!hasMedia) {
            container.visible = true;
            container.opacity = 0.3;
            const placeholder = new Gtk.Button({ cssClasses: ["media-placeholder-btn"] });
            placeholder.set_child(new Gtk.Image({ iconName: "media-playback-start-symbolic" }));
            placeholder.connect("clicked", launchSpotify);
            container.append(sep());
            container.append(placeholder);
            return;
        }
        container.opacity = 1.0;
        container.visible = true;
        // Título de canción
        const titleLabel = new Gtk.Label({
            label: player.title,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            ellipsize: 3,
            maxWidthChars: 14,
        });
        titleLabel.add_css_class("media-title");
        titleLabel.set_size_request(-1, 160);
        container.append(sep());
        container.append(titleLabel);
        // Controles
        const controls = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            halign: Gtk.Align.CENTER,
        });
        const prevBtn = new Gtk.Button();
        prevBtn.set_child(new Gtk.Image({ iconName: "media-skip-backward-symbolic" }));
        prevBtn.connect("clicked", () => player.previous());
        const playBtn = new Gtk.Button();
        playBtn.set_child(new Gtk.Image({
            iconName: player.playbackStatus === Mpris.PlaybackStatus.PLAYING
                ? "media-playback-pause-symbolic"
                : "media-playback-start-symbolic"
        }));
        playBtn.connect("clicked", () => player.play_pause());
        const nextBtn = new Gtk.Button();
        nextBtn.set_child(new Gtk.Image({ iconName: "media-skip-forward-symbolic" }));
        nextBtn.connect("clicked", () => player.next());
        controls.append(prevBtn);
        controls.append(playBtn);
        controls.append(nextBtn);
        container.append(sep());
        container.append(controls);
    };
    mpris.connect("notify::players", update);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update();
        return GLib.SOURCE_CONTINUE;
    });
    update();
    return container;
}
