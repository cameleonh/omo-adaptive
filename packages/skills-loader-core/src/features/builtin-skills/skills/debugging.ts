import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const debuggingSkill: BuiltinSkill = {
	name: "debugging",
	description:
		"Use for runtime debugging that needs reproduction, observation, or a fix: crashes, silent failures, wrong responses, stuck processes, leaks, async or timing bugs, flaky tests, and binary inspection. Start with the smallest discriminating observation, expand hypotheses only when ambiguity warrants it, and parallelize only substantial independent investigations. Load the exact runtime or tool references used by the investigation.",
	template: loadSharedSkillTemplate("debugging"),
}
