import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { MediaControls } from "./SideBar/MediaControls"
import { MediaVisualizer } from "./SideBar/MediaVisualizer"
import AppList from "./SideBar/AppList"
import AudioRoute from "./SideBar/AudioRoute"

const { Gio } = imports.gi;

function launchDetached(command: string) {
    const app = Gio.Subprocess.new(
        [command],
        Gio.SubprocessFlags.SEARCH_PATH | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );
    app.spawn(null);
}

export default function SideBar(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, LEFT } = Astal.WindowAnchor

    return (
        <Astal.Window
            name="sidebar"
            cssClasses={["SideBar"]}
            visible
            gdkmonitor={gdkmonitor}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={TOP | BOTTOM | LEFT}
            application={app}
            layer={Astal.Layer.TOP}
        >
            <box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={["sidebar-container"]}
                spacing={10}
            >
                {/* TOP - App Shortcuts */}
                <AppList />

                {/* CENTER - Media Visualizer */}
                <MediaVisualizer />

                {/* BOTTOM - Media Controls */}
                <box
                    orientation={Gtk.Orientation.VERTICAL}
                    valign={Gtk.Align.END}
                    spacing={8}
                    cssClasses={["system-zone"]}
                >
                    <MediaControls />
                    <AudioRoute />
                </box>
            </box>
        </Astal.Window>
    )
}
