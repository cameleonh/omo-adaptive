import { readRootModel, resolveMultiAgentVersionFromConfig } from "./multi-agent-v2-guard.mjs";
import { findTomlSection as findSection, readTomlSectionSettingValue, replaceOrInsertTomlSectionSetting } from "./toml-section-editor.mjs";

const CODEX_AGENTS_HEADER = "[agents]";
const CODEX_SUBAGENT_THREAD_LIMIT = "6";

/**
 * Ensure the Codex 0.120 subagent concurrency limit. Both V1 and V2 use
 * `[agents] max_threads`; any explicit valid user cap is authoritative.
 * The managed value `6` is only an absent/invalid default. With no model
 * evidence, do not add an `[agents]` section or an absent setting.
 *
 * When no model is resolvable at all (no session model and no root `model`
 * in config.toml — Codex Desktop selects the model in the UI), do not
 * introduce an absent `agents.max_threads`; preserve an existing valid cap
 * and repair only an existing invalid value.
 *
 * @param {string} config
 * @param {{ multiAgentVersion?: string | null, sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 */
export function ensureSubagentConcurrencyLimit(config, options = {}) {
	const multiAgentVersion = options.multiAgentVersion !== undefined ? options.multiAgentVersion : resolveMultiAgentVersionFromConfig(config, options);
	if (multiAgentVersion == null && !hasModelEvidence(config, options)) return raiseExistingAgentsMaxThreads(config);
	return ensureAgentsMaxThreads(config);
}

function hasModelEvidence(config, options) {
	const sessionModel = typeof options.sessionModel === "string" ? options.sessionModel.trim() : "";
	return sessionModel.length > 0 || readRootModel(config) !== null;
}

function raiseExistingAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return config;
	if (readTomlSectionSettingValue(section, "max_threads") === null) return config;
	return ensureValidAgentsMaxThreads(config, section);
}

function ensureAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return appendBlock(config, `${CODEX_AGENTS_HEADER}\nmax_threads = ${CODEX_SUBAGENT_THREAD_LIMIT}\n`);
	return ensureValidAgentsMaxThreads(config, section);
}

function ensureValidAgentsMaxThreads(config, section) {
	const value = readTomlSectionSettingValue(section, "max_threads");
	if (value !== null && Number.isSafeInteger(Number(value)) && Number(value) > 0) {
		return config;
	}
	return replaceOrInsertTomlSectionSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT);
}

function appendBlock(config, block) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}${block}`;
}
