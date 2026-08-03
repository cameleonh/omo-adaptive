import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendSkill: BuiltinSkill = {
	name: "frontend",
	description: "Use for frontend, web UI, UX, visual design, styling, layout, interaction, accessibility, and performance work. Route only the references needed by the requested surface. Full design research, DESIGN.md creation, performance audits, and multi-review visual QA are reserved for greenfield, redesign, reference-fidelity, or otherwise substantial work; localized edits follow the existing system with scoped checks.",
	template: loadSharedSkillTemplate("frontend"),
}
