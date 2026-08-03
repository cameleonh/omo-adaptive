/**
 * Runtime migration for `[features.multi_agent_v2]`.
 *
 * Historical behavior (openai/codex#26753): force `enabled = false` on every
 * SessionStart because enabling V2 made every turn 400 with encrypted
 * spawn_agent parameters on models that were not configured for encrypted
 * tool use. OpenAI closed that as NOT_PLANNED (V2 under development).
 *
 * GPT-5.6 models that declare `multi_agent_version: "v2"` in the Codex model
 * catalog invert that failure mode: forcing `enabled = false` makes every
 * turn 400 with a reserved `collaboration.spawn_agent` schema mismatch
 * (lazycodex#118 / oh-my-openagent#6002 / openai/codex#31097), and
 * Codex 0.120 accepts four fields in the V2 table: `enabled`,
 * `usage_hint_enabled`, `usage_hint_text`, and `hide_spawn_agent_metadata`.
 * The migration preserves those fields and their comments, removes obsolete
 * V2 fields, and moves the legacy thread limit to `[agents].max_threads`.
 *
 * When the selected model is unknown or declares V1, keep the #26753
 * force-disable path.
 *
 * Opt out of the whole migration with LAZYCODEX_CONFIG_MIGRATION_DISABLED=1
 * (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import {
	findTomlSection as findSection,
	readRootTomlSettingValue,
	readTomlSectionSettingValue,
	removeRootTomlSetting,
	removeTomlSection,
	removeTomlSectionSetting,
	removeUnsupportedRootTomlDottedSettings,
	removeUnsupportedTomlSectionDottedSettings,
	removeUnsupportedTomlSectionSettings,
	replaceOrInsertRootTomlSetting,
	replaceOrInsertTomlSectionSetting,
} from "./toml-section-editor.mjs";

const MANAGED_COMMENT_MARKER = "openai/codex#26753";
const MANAGED_DISABLE_COMMENT = [
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
	`# because enabling it fails every turn with HTTP 400 (${MANAGED_COMMENT_MARKER}).`,
	"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
	"",
].join("\n");
const SUPPORTED_MULTI_AGENT_V2_FIELDS = ["enabled", "usage_hint_enabled", "usage_hint_text", "hide_spawn_agent_metadata"];

/**
 * @param {string} config
 * @param {{
 *   multiAgentVersion?: string | null,
 *   sessionModel?: string | null,
 *   requireSessionModel?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   modelsCachePath?: string,
 *   configPath?: string,
 * }} [options]
 */
export function forceDisableMultiAgentV2(config, options = {}) {
	const normalized = normalizeLegacyMultiAgentV2Config(config);
	const sessionModel = normalizeModel(options.sessionModel);
	const multiAgentVersion =
		options.multiAgentVersion !== undefined ? options.multiAgentVersion : resolveMultiAgentVersionFromConfig(normalized.config, options);
	const effectiveModel = sessionModel || readRootModel(normalized.config);

	if (prefersMultiAgentV2(multiAgentVersion, effectiveModel)) {
		return setMultiAgentV2Feature(clearMultiAgentV2DisableForReservedSchema(normalized.config), true);
	}

	// SessionStart can run with an override model (`codex -m gpt-5.6-terra`) while
	// config.toml still lists a different default. If we cannot see the effective
	// session model, do not force-disable — writing enabled=false would break a
	// GPT-5.6 reserved collaboration.spawn_agent session.
	if (options.requireSessionModel === true && !sessionModel) {
		return preserveLegacyFeatureSetting(normalized);
	}

	// No model evidence at all (no session model AND no root `model` in
	// config.toml — Codex Desktop selects the model in the UI): config alone
	// cannot prove the session is not a GPT-5.6 reserved-schema model, and
	// writing `enabled = false` would 400 every turn on those sessions
	// (#6002). Leave the enable state untouched.
	if (multiAgentVersion == null && !sessionModel && !readRootModel(normalized.config)) {
		return preserveLegacyFeatureSetting(normalized);
	}

	// Unknown catalog entry for an explicit session model: skip force-disable
	// rather than assume the legacy encrypted-V2 failure mode.
	if (sessionModel && multiAgentVersion == null) {
		return preserveLegacyFeatureSetting(normalized);
	}

	return forceDisableLegacyEncryptedV2(normalized.config);
}

/**
 * True when the effective model should run MultiAgentV2: the catalog says
 * "v2", or the catalog is unavailable but the model is a GPT-5.6 family
 * model (which reserves the collaboration.spawn_agent schema).
 * @param {"v1" | "v2" | null | undefined} multiAgentVersion
 * @param {string | null | undefined} sessionModel
 */
export function prefersMultiAgentV2(multiAgentVersion, sessionModel) {
	return multiAgentVersion === "v2" || (multiAgentVersion == null && isGpt56Family(normalizeModel(sessionModel)));
}

/**
 * Resolve the effective model against Codex `models_cache.json`.
 * Prefers SessionStart `model` over the root `model` in config.toml.
 * @param {string} config
 * @param {{ sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string, configPath?: string }} [options]
 * @returns {"v1" | "v2" | null}
 */
export function resolveMultiAgentVersionFromConfig(config, options = {}) {
	const model = normalizeModel(options.sessionModel) || readRootModel(config);
	if (!model) return null;
	const version = resolveMultiAgentVersionForModel(model, {
		...options,
		modelsCachePath: options.modelsCachePath?.trim() || resolveModelCatalogPath(readRootModelCatalogPath(config), options) || undefined,
	});
	return version ?? (isGpt56Family(model) ? "v2" : null);
}

/**
 * @param {string} model
 * @param {{ env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 * @returns {"v1" | "v2" | null}
 */
export function resolveMultiAgentVersionForModel(model, options = {}) {
	const cachePath = options.modelsCachePath?.trim() || join(options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex"), "models_cache.json");

	try {
		const cache = JSON.parse(readFileSync(cachePath, "utf8"));
		const models = Array.isArray(cache?.models) ? cache.models : [];
		const entry = models.find((item) => item?.slug === model || item?.id === model);
		const version = entry?.multi_agent_version;
		if (version === "v1" || version === "v2") return version;
		return null;
	} catch {
		return null;
	}
}

export function readRootModel(config) {
	const double = config.match(/^\s*model\s*=\s*"([^"]+)"/m);
	if (double) return double[1];
	const single = config.match(/^\s*model\s*=\s*'([^']+)'/m);
	return single?.[1] ?? null;
}

// Codex documents `model_catalog_json` as a COMPLETE replacement for the
// fetched models_cache.json (codex-rs/core/src/config/mod.rs load_model_catalog
// -> load_catalog_json -> ModelsResponse). When set, Codex resolves the model
// only from that file, so the guard must too — otherwise Codex and the guard
// disagree on the multi-agent version (lazycodex#120).
export function readRootModelCatalogPath(config) {
	const double = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m);
	if (double) return double[1];
	const single = config.match(/^\s*model_catalog_json\s*=\s*'([^']+)'/m);
	return single?.[1] ?? null;
}

function resolveModelCatalogPath(configuredPath, options) {
	const trimmed = normalizeModel(configuredPath);
	if (!trimmed) return null;
	if (isAbsolute(trimmed)) return trimmed;
	const baseDir = options.configPath ? dirname(options.configPath) : options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex");
	return join(baseDir, trimmed);
}

function normalizeModel(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isGpt56Family(model) {
	return typeof model === "string" && /^gpt-5\.6\b/i.test(model);
}

function clearMultiAgentV2DisableForReservedSchema(config) {
	return removeManagedDisableComments(config);
}

function forceDisableLegacyEncryptedV2(config) {
	return ensureManagedComment(setMultiAgentV2Feature(config, false));
}

function ensureManagedComment(config) {
	if (config.includes(MANAGED_COMMENT_MARKER)) return config;
	const section = findSection(config, "[features.multi_agent_v2]") ?? findSection(config, "[features]");
	if (!section && hasRootDottedMultiAgentV2Options(config)) {
		return MANAGED_DISABLE_COMMENT + config;
	}
	if (!section) return config;
	return config.slice(0, section.start) + MANAGED_DISABLE_COMMENT + config.slice(section.start);
}

function removeManagedDisableComments(config) {
	if (!config.includes(MANAGED_COMMENT_MARKER) && !config.includes("Managed by LazyCodex: multi_agent_v2")) {
		return config;
	}

	const lines = config.split("\n");
	const kept = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (
			trimmed.startsWith("#") &&
			(trimmed.includes(MANAGED_COMMENT_MARKER) ||
				trimmed.includes("Managed by LazyCodex: multi_agent_v2") ||
				trimmed.includes("because enabling it fails every turn with HTTP 400") ||
				trimmed.includes("LAZYCODEX_CONFIG_MIGRATION_DISABLED=1") ||
				trimmed.includes("OMO_CODEX_CONFIG_MIGRATION_DISABLED=1"))
		) {
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function setMultiAgentV2Feature(config, enabled) {
	const v2Section = findSection(config, "[features.multi_agent_v2]");
	if (v2Section) return replaceOrInsertTomlSectionSetting(config, v2Section, "enabled", String(enabled));
	const featuresSection = findSection(config, "[features]");
	if (featuresSection && hasDottedMultiAgentV2Options(featuresSection)) {
		return replaceOrInsertTomlSectionSetting(config, featuresSection, "multi_agent_v2.enabled", String(enabled));
	}
	if (hasRootDottedMultiAgentV2Options(config)) {
		return replaceOrInsertRootTomlSetting(config, "features.multi_agent_v2.enabled", String(enabled));
	}
	return appendBlock(config, `[features.multi_agent_v2]\nenabled = ${enabled}\n`);
}

function preserveLegacyFeatureSetting(normalized) {
	if (normalized.legacyEnabled === null) return normalized.config;
	return setMultiAgentV2Feature(normalized.config, normalized.legacyEnabled);
}

function normalizeLegacyMultiAgentV2Config(config) {
	let result = config;
	let legacyEnabled = null;
	let legacyThreadLimit = null;

	const nestedSection = findSection(result, "[features.multi_agent_v2]");
	if (nestedSection) {
		legacyEnabled = readBoolean(readTomlSectionSettingValue(nestedSection, "enabled"));
		legacyThreadLimit = readPositiveInteger(readTomlSectionSettingValue(nestedSection, "max_concurrent_threads_per_session"));
		if (legacyThreadLimit !== null) {
			result = removeTomlSectionSetting(result, nestedSection, "max_concurrent_threads_per_session", String(legacyThreadLimit));
		}
		const sectionWithoutUnsupportedSettings = findSection(result, "[features.multi_agent_v2]");
		if (sectionWithoutUnsupportedSettings) {
			result = removeUnsupportedTomlSectionSettings(result, sectionWithoutUnsupportedSettings, SUPPORTED_MULTI_AGENT_V2_FIELDS);
		}
		const remainingSection = findSection(result, "[features.multi_agent_v2]");
		if (remainingSection && !hasTomlSettings(remainingSection)) result = removeTomlSection(result, remainingSection);
	}

	const featuresSection = findSection(result, "[features]");
	if (featuresSection) {
		const scalarEnabled = readBoolean(readTomlSectionSettingValue(featuresSection, "multi_agent_v2"));
		const dottedEnabled = readBoolean(readTomlSectionSettingValue(featuresSection, "multi_agent_v2.enabled"));
		const dottedLimit = readPositiveInteger(readTomlSectionSettingValue(featuresSection, "multi_agent_v2.max_concurrent_threads_per_session"));
		legacyEnabled ??= dottedEnabled ?? scalarEnabled;
		legacyThreadLimit ??= dottedLimit;
		if (scalarEnabled !== null) result = removeTomlSectionSetting(result, featuresSection, "multi_agent_v2", String(scalarEnabled));
		let refreshedFeatures = findSection(result, "[features]");
		if (refreshedFeatures && dottedLimit !== null) {
			result = removeTomlSectionSetting(result, refreshedFeatures, "multi_agent_v2.max_concurrent_threads_per_session", String(dottedLimit));
		}
		refreshedFeatures = findSection(result, "[features]");
		if (refreshedFeatures) {
			result = removeUnsupportedTomlSectionDottedSettings(result, refreshedFeatures, "multi_agent_v2", SUPPORTED_MULTI_AGENT_V2_FIELDS);
		}
	}

	const rootScalarEnabled = readBoolean(readRootTomlSettingValue(result, "features.multi_agent_v2"));
	const rootEnabled = readBoolean(readRootTomlSettingValue(result, "features.multi_agent_v2.enabled"));
	const rootLimit = readPositiveInteger(readRootTomlSettingValue(result, "features.multi_agent_v2.max_concurrent_threads_per_session"));
	legacyEnabled ??= rootEnabled ?? rootScalarEnabled;
	legacyThreadLimit ??= rootLimit;
	if (rootScalarEnabled !== null) result = removeRootTomlSetting(result, "features.multi_agent_v2", String(rootScalarEnabled));
	if (rootLimit !== null) result = removeRootTomlSetting(result, "features.multi_agent_v2.max_concurrent_threads_per_session", String(rootLimit));
	result = removeUnsupportedRootTomlDottedSettings(result, "features.multi_agent_v2", SUPPORTED_MULTI_AGENT_V2_FIELDS);
	if (legacyThreadLimit !== null) result = mergeLegacyThreadLimit(result, legacyThreadLimit);

	return { config: result, legacyEnabled };
}

function mergeLegacyThreadLimit(config, limit) {
	const section = findSection(config, "[agents]");
	if (!section) return appendBlock(config, `[agents]\nmax_threads = ${limit}\n`);
	const current = readPositiveInteger(readTomlSectionSettingValue(section, "max_threads"));
	if (current !== null) return config;
	return replaceOrInsertTomlSectionSetting(config, section, "max_threads", String(limit));
}

function readBoolean(value) {
	if (value === "true") return true;
	if (value === "false") return false;
	return null;
}

function readPositiveInteger(value) {
	if (!/^\d+$/.test(value ?? "")) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasTomlSettings(section) {
	return section.text
		.split("\n")
		.slice(1)
		.some((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));
}

function hasDottedMultiAgentV2Options(section) {
	return SUPPORTED_MULTI_AGENT_V2_FIELDS.some((key) => readTomlSectionSettingValue(section, `multi_agent_v2.${key}`) !== null);
}

function hasRootDottedMultiAgentV2Options(config) {
	return SUPPORTED_MULTI_AGENT_V2_FIELDS.some((key) => readRootTomlSettingValue(config, `features.multi_agent_v2.${key}`) !== null);
}

function appendBlock(config, block) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}${block}`;
}
