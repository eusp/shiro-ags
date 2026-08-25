import { jsx as _jsx } from "ags/gtk4/jsx-runtime";
import Hyprland from "gi://AstalHyprland";
import Pango from "gi://Pango";
const hypr = Hyprland.get_default();
export default function ActiveWindow() {
    const label = (_jsx("label", { cssClasses: ["window-title"], maxWidthChars: 40, ellipsize: Pango.EllipsizeMode.END }));
    const update = () => {
        const client = hypr.focusedClient;
        label.label = client ? client.title : "";
        label.visible = !!client;
    };
    hypr.connect("notify::focused-client", update);
    update();
    return label;
}
