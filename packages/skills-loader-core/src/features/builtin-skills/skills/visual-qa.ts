import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const visualQaSkill: BuiltinSkill = {
	name: "visual-qa",
	description:
		"Use to verify rendered web or terminal UI when visual behavior changed, a regression is suspected, or reference fidelity, responsive layout, CJK wrapping, or TUI alignment matters. Localized changes use scoped captures and self-review; significant cross-page, release, or reference-fidelity work adds two independent reviewer passes.",
	template: loadSharedSkillTemplate("visual-qa"),
}
