import { jsx as _jsx } from "ags/gtk4/jsx-runtime";
import Hyprland from "../../lib/hyprland";
const hypr = Hyprland.get_default();
export default function Workspaces() {
    const buttons = [];
    const list = _jsx("box", { spacing: 8, cssClasses: ["workspaces"] });
    const update = () => {
        const current = hypr.focusedWorkspace.id;
        if (buttons.length === 0) {
            const count = 5;
            for (let i = 1; i <= count; i++) {
                const dot = _jsx("box", { cssClasses: ["dot"] });
                dot.set_size_request(6, 10);
                const btn = _jsx("button", { onClicked: () => hypr.dispatch("workspace", String(i)), children: dot });
                btn.add_css_class("ws-dot");
                btn.set_margin_top(9);
                btn.set_margin_bottom(9);
                btn.set_size_request(12, 12);
                buttons.push(btn);
                list.append(btn);
            }
        }
        buttons.forEach((btn, index) => {
            const wsNumber = index + 1;
            if (wsNumber === current) {
                btn.add_css_class("active");
            }
            else {
                btn.remove_css_class("active");
            }
        });
    };
    const handlerId = hypr.connect("notify::focused-workspace", update);
    list.connect("destroy", () => {
        hypr.disconnect(handlerId);
    });
    update();
    return list;
}
