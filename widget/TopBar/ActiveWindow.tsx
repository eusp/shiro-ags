import { Gtk } from "ags/gtk4"
import Hyprland from "../../lib/hyprland"
import Pango from "gi://Pango"

const hypr = Hyprland.get_default()

export default function ActiveWindow() {
    const label = (
        <label
            cssClasses={["window-title"]}
            maxWidthChars={40}
            ellipsize={Pango.EllipsizeMode.END}
        />
    ) as Gtk.Label

    const update = () => {
        const client = hypr.focusedClient
        label.label = client ? client.title : ""
        label.visible = !!client
    }

    hypr.connect("notify::focused-client", update)
    update()
    return label
}
