import { jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { execAsync } from "ags/process";
export default function ClockWeather() {
    const timeLabel = new Gtk.Label({
        cssClasses: ["clock-time"],
        halign: Gtk.Align.CENTER
    });
    const dateLabel = new Gtk.Label({
        cssClasses: ["clock-date"],
        halign: Gtk.Align.CENTER
    });
    const weatherLabel = new Gtk.Label({
        cssClasses: ["clock-weather"],
        halign: Gtk.Align.CENTER,
        label: "Cargando clima..."
    });
    const updateTime = () => {
        const time = GLib.DateTime.new_now_local();
        timeLabel.label = time.format("%H:%M") || "";
        dateLabel.label = time.format("%A, %d de %B") || "";
    };
    const updateWeather = () => {
        execAsync("curl -s 'wttr.in/?format=%c+%t'")
            .then(output => {
            weatherLabel.label = output.trim() || "Clima no disponible";
        })
            .catch(() => {
            weatherLabel.label = "Error de clima";
        });
    };
    // Update time every second (or minute, but second for smoothness if showing seconds later)
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        updateTime();
        return GLib.SOURCE_CONTINUE;
    });
    // Update weather every 30 minutes
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1800000, () => {
        updateWeather();
        return GLib.SOURCE_CONTINUE;
    });
    updateTime();
    updateWeather();
    return (_jsxs("box", { orientation: Gtk.Orientation.VERTICAL, cssClasses: ["clock-weather-container"], spacing: 4, children: [timeLabel, _jsxs("box", { orientation: Gtk.Orientation.HORIZONTAL, cssClasses: ["clock-weather-container"], spacing: 4, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER, children: [dateLabel, weatherLabel] })] }));
}
