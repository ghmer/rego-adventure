/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// Quest pack validation rules the editor enforces before it exports.
//
// The backend enforces the same set: a quests.json that violates one of these
// rules is refused at pack load and never served. PACK_RULES states that set
// declaratively, and backend/quest/rules_parity_test.go compares it against
// the server's own checks - the limit values, a fixture pack per rule, and the
// field labels the server's validation calls use - so a rule cannot be added,
// renamed or changed on one side alone.
//
// Keys of `limits` are the constant names from backend/quest/constants.go on
// purpose: the parity test compares them by name.
//
// Each rule carries:
//   id           stable name, referenced by the parity fixtures
//   kind         nonEmpty | maxLength | minItems | maxItems | charset |
//                urlScheme | maxJsonBytes | contiguousIds | uniqueIds |
//                formatVersion | npcDefaultDefined | maxKeys |
//                npcNameRequired | npcNameMaxLength | npcNameCharset |
//                npcImageRequired | npcImageMaxLength | npcImagePath |
//                npcDefined | heroNpcCharset | heroNpcDefined | imagePath
//   path         where the value sits; a `[]` suffix takes the elements of an
//                array, so `quests[].hints[]` selects every hint of every quest
//   host, field  for the ID rules: the array whose elements carry the IDs
//   limit        key into `limits` for the length-shaped kinds
//   min          for minItems
//   schemes      for urlScheme
//   pattern      for charset
//   from         for contiguousIds
//   optional     skip an absent or empty value
//   serverLabel  the field label in the server's message for this check, with
//                `{i}` for an index and `{n}` for a quest number
//
// The npc roster kinds walk Object.entries(pack.npcs) in sorted key order -
// the same order the backend validates in - so both sides report the same
// entry as the offender. npcDefined checks that a lore entry's speaker names
// a declared npc and reads the roster off the pack, so it runs against the
// entry lists selected by its path.

const PACK_RULES = JSON.parse(`{
  "limits": {
    "FormatVersion": 2,
    "MaxPackTitle": 100,
    "MaxPackDescription": 500,
    "MaxPackGenre": 50,
    "MaxPackObjective": 500,
    "MaxUIGrimoireTitle": 100,
    "MaxUIHintButton": 100,
    "MaxUIVerifyButton": 100,
    "MaxUIVerifying": 100,
    "MaxUIMessageSuccess": 200,
    "MaxUIMessageFailure": 200,
    "MaxUIPerfectScoreMessage": 1000,
    "MaxUIPerfectScoreButton": 100,
    "MaxUIBeginAdventureButton": 100,
    "MaxQuestTitle": 100,
    "MaxQuestDescriptionTask": 1000,
    "MaxQuestDescriptionLore": 2000,
    "MaxQuestHint": 500,
    "MaxQuestSolution": 5000,
    "MaxQuestTemplate": 10000,
    "MaxQuestTests": 100,
    "MaxQuestSupportModules": 5,
    "MaxQuestSupportModule": 10000,
    "MaxManualDataModel": 2000,
    "MaxManualRegoSnippet": 5000,
    "MaxManualExternalLink": 500,
    "MaxPrologueItem": 2000,
    "MaxEpilogueItem": 2000,
    "MaxTestPayloadBytes": 50000,
    "MaxPackNPCs": 50,
    "MaxNPCName": 64,
    "MaxImageName": 500
  },
  "defaultNPCKey": "default_npc",
  "rules": [
    { "id": "pack_title_required", "path": "meta.title", "kind": "nonEmpty", "serverLabel": "pack title" },
    { "id": "pack_title_max_length", "path": "meta.title", "kind": "maxLength", "limit": "MaxPackTitle", "serverLabel": "pack title" },
    { "id": "pack_description_required", "path": "meta.description", "kind": "nonEmpty", "serverLabel": "pack description" },
    { "id": "pack_description_max_length", "path": "meta.description", "kind": "maxLength", "limit": "MaxPackDescription", "serverLabel": "pack description" },
    { "id": "pack_genre_required", "path": "meta.genre", "kind": "nonEmpty", "serverLabel": "pack genre" },
    { "id": "pack_genre_max_length", "path": "meta.genre", "kind": "maxLength", "limit": "MaxPackGenre", "serverLabel": "pack genre" },
    { "id": "pack_genre_charset", "path": "meta.genre", "kind": "charset", "serverLabel": "pack genre" },
    { "id": "pack_initial_objective_max_length", "path": "meta.initial_objective", "kind": "maxLength", "limit": "MaxPackObjective", "optional": true, "serverLabel": "pack initial_objective" },
    { "id": "pack_final_objective_max_length", "path": "meta.final_objective", "kind": "maxLength", "limit": "MaxPackObjective", "optional": true, "serverLabel": "pack final_objective" },

    { "id": "ui_grimoire_title_required", "path": "ui_labels.grimoire_title", "kind": "nonEmpty", "serverLabel": "ui_labels.grimoire_title" },
    { "id": "ui_grimoire_title_max_length", "path": "ui_labels.grimoire_title", "kind": "maxLength", "limit": "MaxUIGrimoireTitle", "serverLabel": "ui_labels.grimoire_title" },
    { "id": "ui_hint_button_required", "path": "ui_labels.hint_button", "kind": "nonEmpty", "serverLabel": "ui_labels.hint_button" },
    { "id": "ui_hint_button_max_length", "path": "ui_labels.hint_button", "kind": "maxLength", "limit": "MaxUIHintButton", "serverLabel": "ui_labels.hint_button" },
    { "id": "ui_verify_button_required", "path": "ui_labels.verify_button", "kind": "nonEmpty", "serverLabel": "ui_labels.verify_button" },
    { "id": "ui_verify_button_max_length", "path": "ui_labels.verify_button", "kind": "maxLength", "limit": "MaxUIVerifyButton", "serverLabel": "ui_labels.verify_button" },
    { "id": "ui_verifying_max_length", "path": "ui_labels.verifying", "kind": "maxLength", "limit": "MaxUIVerifying", "optional": true, "serverLabel": "ui_labels.verifying" },
    { "id": "ui_message_success_max_length", "path": "ui_labels.message_success", "kind": "maxLength", "limit": "MaxUIMessageSuccess", "optional": true, "serverLabel": "ui_labels.message_success" },
    { "id": "ui_message_failure_max_length", "path": "ui_labels.message_failure", "kind": "maxLength", "limit": "MaxUIMessageFailure", "optional": true, "serverLabel": "ui_labels.message_failure" },
    { "id": "ui_perfect_score_message_max_length", "path": "ui_labels.perfect_score_message", "kind": "maxLength", "limit": "MaxUIPerfectScoreMessage", "optional": true, "serverLabel": "ui_labels.perfect_score_message" },
    { "id": "ui_perfect_score_button_text_max_length", "path": "ui_labels.perfect_score_button_text", "kind": "maxLength", "limit": "MaxUIPerfectScoreButton", "optional": true, "serverLabel": "ui_labels.perfect_score_button_text" },
    { "id": "ui_begin_adventure_button_max_length", "path": "ui_labels.begin_adventure_button", "kind": "maxLength", "limit": "MaxUIBeginAdventureButton", "optional": true, "serverLabel": "ui_labels.begin_adventure_button" },

    { "id": "pack_version_format", "path": "version", "kind": "formatVersion", "limit": "FormatVersion" },

    { "id": "pack_npcs_default_npc", "path": "npcs", "kind": "npcDefaultDefined" },
    { "id": "pack_npcs_max_items", "path": "npcs", "kind": "maxKeys", "limit": "MaxPackNPCs" },
    { "id": "pack_npc_name_required", "path": "npcs", "kind": "npcNameRequired", "serverLabel": "npcs[{i}] name" },
    { "id": "pack_npc_name_max_length", "path": "npcs", "kind": "npcNameMaxLength", "limit": "MaxNPCName", "serverLabel": "npcs[{i}] name" },
    { "id": "pack_npc_name_charset", "path": "npcs", "kind": "npcNameCharset" },
    { "id": "pack_npc_image_required", "path": "npcs", "kind": "npcImageRequired", "serverLabel": "npcs[{i}] image" },
    { "id": "pack_npc_image_max_length", "path": "npcs", "kind": "npcImageMaxLength", "limit": "MaxImageName", "serverLabel": "npcs[{i}] image" },
    { "id": "pack_npc_image_path", "path": "npcs", "kind": "npcImagePath" },

    { "id": "pack_hero_avatar_required", "path": "hero_avatar", "kind": "nonEmpty", "serverLabel": "hero_avatar" },
    { "id": "pack_hero_avatar_max_length", "path": "hero_avatar", "kind": "maxLength", "limit": "MaxNPCName", "serverLabel": "hero_avatar" },
    { "id": "pack_hero_avatar_charset", "path": "hero_avatar", "kind": "heroNpcCharset" },
    { "id": "pack_hero_avatar_defined", "path": "hero_avatar", "kind": "heroNpcDefined" },

    { "id": "pack_background_image_required", "path": "background_image", "kind": "nonEmpty", "serverLabel": "background_image" },
    { "id": "pack_background_image_max_length", "path": "background_image", "kind": "maxLength", "limit": "MaxImageName", "serverLabel": "background_image" },
    { "id": "pack_background_image_path", "path": "background_image", "kind": "imagePath" },

    { "id": "pack_prologue_min_items", "path": "prologue", "kind": "minItems", "min": 1 },
    { "id": "pack_prologue_item_npc_required", "path": "prologue[].npc", "kind": "nonEmpty", "serverLabel": "prologue[{i}] npc" },
    { "id": "pack_prologue_item_npc_defined", "path": "prologue[]", "kind": "npcDefined" },
    { "id": "pack_prologue_item_max_length", "path": "prologue[].text", "kind": "maxLength", "limit": "MaxPrologueItem", "serverLabel": "prologue[{i}]" },
    { "id": "pack_epilogue_min_items", "path": "epilogue", "kind": "minItems", "min": 1 },
    { "id": "pack_epilogue_item_npc_required", "path": "epilogue[].npc", "kind": "nonEmpty", "serverLabel": "epilogue[{i}] npc" },
    { "id": "pack_epilogue_item_npc_defined", "path": "epilogue[]", "kind": "npcDefined" },
    { "id": "pack_epilogue_item_max_length", "path": "epilogue[].text", "kind": "maxLength", "limit": "MaxEpilogueItem", "serverLabel": "epilogue[{i}]" },
    { "id": "pack_quests_min_items", "path": "quests", "kind": "minItems", "min": 1 },

    { "id": "quest_ids_contiguous", "kind": "contiguousIds", "host": "quests", "field": "id", "from": 1 },
    { "id": "quest_ids_unique", "kind": "uniqueIds", "host": "quests", "field": "id" },
    { "id": "quest_title_required", "path": "quests[].title", "kind": "nonEmpty", "serverLabel": "quest {n} title" },
    { "id": "quest_title_max_length", "path": "quests[].title", "kind": "maxLength", "limit": "MaxQuestTitle", "serverLabel": "quest {n} title" },
    { "id": "quest_task_required", "path": "quests[].description_task", "kind": "nonEmpty", "serverLabel": "quest {n} task" },
    { "id": "quest_task_max_length", "path": "quests[].description_task", "kind": "maxLength", "limit": "MaxQuestDescriptionTask", "serverLabel": "quest {n} task" },
    { "id": "quest_lore_min_items", "path": "quests[].description_lore", "kind": "minItems", "min": 1 },
    { "id": "quest_lore_npc_required", "path": "quests[].description_lore[].npc", "kind": "nonEmpty", "serverLabel": "quest {n} lore[{i}] npc" },
    { "id": "quest_lore_npc_defined", "path": "quests[].description_lore[]", "kind": "npcDefined" },
    { "id": "quest_lore_item_max_length", "path": "quests[].description_lore[].text", "kind": "maxLength", "limit": "MaxQuestDescriptionLore", "serverLabel": "quest {n} lore[{i}]" },
    { "id": "quest_hint_item_max_length", "path": "quests[].hints[]", "kind": "maxLength", "limit": "MaxQuestHint", "serverLabel": "quest {n} hint[{i}]" },
    { "id": "quest_solution_max_length", "path": "quests[].solution", "kind": "maxLength", "limit": "MaxQuestSolution", "optional": true, "serverLabel": "quest {n} solution" },
    { "id": "quest_template_max_length", "path": "quests[].template", "kind": "maxLength", "limit": "MaxQuestTemplate", "optional": true, "serverLabel": "quest {n} template" },
    { "id": "quest_query_required", "path": "quests[].query", "kind": "nonEmpty", "serverLabel": "quest {n} query" },
    { "id": "quest_manual_data_model_max_length", "path": "quests[].manual.data_model", "kind": "maxLength", "limit": "MaxManualDataModel", "serverLabel": "quest {n} manual.data_model" },
    { "id": "quest_manual_rego_snippet_max_length", "path": "quests[].manual.rego_snippet", "kind": "maxLength", "limit": "MaxManualRegoSnippet", "serverLabel": "quest {n} manual.rego_snippet" },
    { "id": "quest_manual_external_link_max_length", "path": "quests[].manual.external_link", "kind": "maxLength", "limit": "MaxManualExternalLink", "serverLabel": "quest {n} manual.external_link" },
    { "id": "quest_manual_external_link_scheme", "path": "quests[].manual.external_link", "kind": "urlScheme", "schemes": ["http", "https"], "optional": true },
    { "id": "quest_support_modules_max_items", "path": "quests[].support_modules", "kind": "maxItems", "limit": "MaxQuestSupportModules" },
    { "id": "quest_support_module_non_empty", "path": "quests[].support_modules[]", "kind": "nonEmpty", "serverLabel": "quest {n} support_modules[{i}]" },
    { "id": "quest_support_module_max_length", "path": "quests[].support_modules[]", "kind": "maxLength", "limit": "MaxQuestSupportModule", "serverLabel": "quest {n} support_modules[{i}]" },
    { "id": "quest_tests_min_items", "path": "quests[].tests", "kind": "minItems", "min": 1 },
    { "id": "quest_tests_max_items", "path": "quests[].tests", "kind": "maxItems", "limit": "MaxQuestTests" },
    { "id": "quest_test_payload_max_bytes", "path": "quests[].tests[].payload", "kind": "maxJsonBytes", "limit": "MaxTestPayloadBytes" },
    { "id": "quest_test_ids_unique", "kind": "uniqueIds", "host": "quests[].tests", "field": "id" }
  ]
}`);

// PACK_LIMITS is the length budget the editor puts on its form fields. The
// numbers are the backend's, pinned by the parity test.
const PACK_LIMITS = PACK_RULES.limits;
const DEFAULT_NPC_KEY = PACK_RULES.defaultNPCKey;

// PACK_GENRE_PATTERN is the character set the backend accepts for a genre
// (alphanumericPattern in backend/quest/models.go). Go's \s is tab, newline,
// form feed, carriage return and space, spelled out here so both sides mean the
// same set; the pack_genre_charset fixtures pin that reading.
const PACK_GENRE_PATTERN = /^[a-zA-Z0-9\t\n\f\r \-_.,!?']+$/;

// NPC_NAME_PATTERN is the npc key charset the backend accepts, mirroring
// npcKeyPattern in backend/quest/models.go.
const NPC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

// NPC_IMAGE_PREFIX and NPC_IMAGE_EXTENSIONS mirror NPCImagePrefix and
// npcImageExtensions in backend/quest/models.go: an npc image addresses a
// media file inside the pack's assets directory.
const NPC_IMAGE_PREFIX = 'assets/';
const NPC_IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp'];

// ============================================================================
// LOOKUP
// ============================================================================

// valuesAt resolves a rule path against a pack and returns one site per value
// the path selects, with the trail it was found at (used in messages). A path
// that walks through a missing key still yields a site, so a required field
// that is absent entirely is reported instead of skipped.
function valuesAt(pack, path) {
    let sites = [{ value: pack, trail: '' }];

    for (const segment of path.split('.')) {
        const parts = segment.match(/^([^[\]]+)(\[\])?$/);
        if (!parts) {
            return [];
        }
        const key = parts[1];
        const takesElements = parts[2] === '[]';

        const next = [];
        for (const site of sites) {
            if (site.value === null || typeof site.value !== 'object') {
                continue;
            }
            const value = site.value[key];
            const trail = site.trail ? `${site.trail}.${key}` : key;

            if (!takesElements) {
                next.push({ value, trail });
                continue;
            }
            if (!Array.isArray(value)) {
                continue;
            }
            value.forEach((item, index) => {
                next.push({ value: item, trail: `${trail}[${index}]` });
            });
        }
        sites = next;
    }

    return sites;
}

// renderTrail turns a path trail into author-facing wording: array positions
// are counted from 1 and the quest list reads "quest 2".
function renderTrail(trail) {
    return trail
        .split('.')
        .map((part) => {
            const parts = part.match(/^([^[\]]+)\[(\d+)\]$/);
            if (!parts) {
                return part;
            }
            const name = parts[1] === 'quests' ? 'quest' : parts[1];
            return `${name} ${Number(parts[2]) + 1}`;
        })
        .join(' ');
}

function codePoints(text) {
    return Array.from(String(text)).length;
}

function utf8Bytes(text) {
    return new TextEncoder().encode(text).length;
}

// ============================================================================
// RULE KINDS
// ============================================================================

const RULE_CHECKS = {
    nonEmpty(rule, site) {
        const text = typeof site.value === 'string' ? site.value : '';
        return text.trim() === '' ? 'cannot be empty' : null;
    },

    maxLength(rule, site) {
        if (site.value === null || site.value === undefined) {
            return null;
        }
        const text = typeof site.value === 'string' ? site.value : String(site.value);
        if (rule.optional && text === '') {
            return null;
        }
        const max = PACK_LIMITS[rule.limit];
        const length = codePoints(text);
        return length > max
            ? `exceeds maximum length of ${max} characters (got ${length})`
            : null;
    },

    minItems(rule, site) {
        const count = Array.isArray(site.value) ? site.value.length : 0;
        return count < rule.min
            ? `must have at least ${rule.min} entry, got ${count}`
            : null;
    },

    maxItems(rule, site) {
        const count = Array.isArray(site.value) ? site.value.length : 0;
        const max = PACK_LIMITS[rule.limit];
        return count > max ? `has ${count} entries, maximum is ${max}` : null;
    },

    charset(rule, site) {
        if (typeof site.value !== 'string' || site.value === '') {
            return null;
        }
        return PACK_GENRE_PATTERN.test(site.value)
            ? null
            : 'contains invalid characters (only alphanumeric and basic punctuation allowed)';
    },

    urlScheme(rule, site) {
        if (typeof site.value !== 'string' || site.value === '') {
            return null;
        }
        let scheme = '';
        try {
            scheme = new URL(site.value).protocol.replace(/:$/, '').toLowerCase();
        } catch (error) {
            return 'is not a valid URL';
        }
        return rule.schemes.includes(scheme)
            ? null
            : `must use ${rule.schemes.join(' or ')} scheme, got "${scheme}"`;
    },

    maxJsonBytes(rule, site) {
        if (site.value === null || site.value === undefined) {
            return null;
        }
        const max = PACK_LIMITS[rule.limit];
        // Measured as the backend measures it: the payload as the pack loader
        // reads it, which carries input, plus data only when it holds
        // something, and nothing else.
        const size = utf8Bytes(JSON.stringify(serverPayloadShape(site.value)));
        return size > max
            ? `test payload exceeds maximum size of ${max} bytes (got ${size})`
            : null;
    },

    formatVersion(rule, site) {
        return site.value === PACK_LIMITS[rule.limit]
            ? null
            : `pack format version must be ${PACK_LIMITS[rule.limit]}; run the migration tool on older packs`;
    },

    npcDefaultDefined(rule, site) {
        const npcs = site.value;
        const declared = npcs !== null && typeof npcs === 'object' && !Array.isArray(npcs)
            && Object.prototype.hasOwnProperty.call(npcs, PACK_RULES.defaultNPCKey);
        return declared
            ? null
            : `roster must declare ${JSON.stringify(PACK_RULES.defaultNPCKey)} as the fallback speaker`;
    },

    maxKeys(rule, site) {
        const npcs = site.value;
        const count = npcs !== null && typeof npcs === 'object' && !Array.isArray(npcs)
            ? Object.keys(npcs).length
            : 0;
        const max = PACK_LIMITS[rule.limit];
        return count > max
            ? `roster has ${count} npc characters, maximum is ${max}`
            : null;
    },

    npcNameRequired(rule, entry) {
        const name = typeof entry.name === 'string' ? entry.name : '';
        return name.trim() === '' ? 'name cannot be empty' : null;
    },

    npcNameMaxLength(rule, entry) {
        const name = typeof entry.name === 'string' ? entry.name : '';
        const length = codePoints(name);
        const max = PACK_LIMITS[rule.limit];
        return length > max
            ? `name exceeds maximum length of ${max} characters (got ${length})`
            : null;
    },

    npcNameCharset(rule, entry) {
        const name = typeof entry.name === 'string' ? entry.name : '';
        return name === '' || NPC_NAME_PATTERN.test(name)
            ? null
            : 'name contains invalid characters (must start with a letter and use only letters, numbers, hyphens and underscores)';
    },

    npcImageRequired(rule, entry) {
        const image = typeof entry.image === 'string' ? entry.image : '';
        return image.trim() === '' ? 'image cannot be empty' : null;
    },

    npcImageMaxLength(rule, entry) {
        const image = typeof entry.image === 'string' ? entry.image : String(entry.image ?? '');
        const length = codePoints(image);
        const max = PACK_LIMITS[rule.limit];
        return length > max
            ? `image exceeds maximum length of ${max} characters (got ${length})`
            : null;
    },

    npcImagePath(rule, entry) {
        const image = typeof entry.image === 'string' ? entry.image : '';
        if (image.trim() === '') {
            return null;
        }
        if (!image.startsWith(NPC_IMAGE_PREFIX)) {
            return `image must point inside the pack assets directory (must start with ${JSON.stringify(NPC_IMAGE_PREFIX)})`;
        }
        const rest = image.slice(NPC_IMAGE_PREFIX.length);
        if (rest === '') {
            return 'image must name a file inside the pack assets directory';
        }
        if (rest.includes('..') || rest.includes('\\')) {
            return 'image must stay inside the pack assets directory (path traversal is not allowed)';
        }
        if (/\s/.test(rest)) {
            return 'image must not contain whitespace (only URL-safe paths are allowed)';
        }
        return RULE_CHECKS.imageExtension(rule, image);
    },

    // heroNpcCharset checks the hero pointer names a well-formed npc key;
    // an empty value is left to the required rule, like the roster names.
    heroNpcCharset(rule, site) {
        const name = typeof site.value === 'string' ? site.value : '';
        return name === '' || NPC_NAME_PATTERN.test(name)
            ? null
            : 'contains invalid characters (must start with a letter and use only letters, numbers, hyphens and underscores)';
    },

    // imagePath checks a pack media path (the background) the way npc
    // portraits are checked: inside the pack assets directory, media
    // extension. The empty value is left to the required rule.
    imagePath(rule, site) {
        const image = typeof site.value === 'string' ? site.value : '';
        if (image.trim() === '') {
            return null;
        }
        if (!image.startsWith(NPC_IMAGE_PREFIX)) {
            return `must point inside the pack assets directory (must start with ${JSON.stringify(NPC_IMAGE_PREFIX)})`;
        }
        const rest = image.slice(NPC_IMAGE_PREFIX.length);
        if (rest === '') {
            return 'must name a file inside the pack assets directory';
        }
        if (rest.includes('..') || rest.includes('\\')) {
            return 'must stay inside the pack assets directory (path traversal is not allowed)';
        }
        if (/\s/.test(rest)) {
            return 'must not contain whitespace (only URL-safe paths are allowed)';
        }
        return RULE_CHECKS.imageExtension(rule, image);
    },

    imageExtension(rule, image) {
        const ext = (image.match(/\.[^.]*$/)?.[0] ?? '').toLowerCase();
        return NPC_IMAGE_EXTENSIONS.includes(ext)
            ? null
            : `image must use one of the extensions: ${NPC_IMAGE_EXTENSIONS.join(', ')}`;
    },

    contiguousIds(rule, ids) {
        for (let index = 0; index < ids.length; index += 1) {
            if (ids[index] !== rule.from + index) {
                return `at position ${index + 1} has ID ${ids[index]}; ` +
                    `IDs must be contiguous starting at ${rule.from}`;
            }
        }
        return null;
    },

    uniqueIds(rule, ids) {
        const seen = new Set();
        for (const id of ids) {
            if (seen.has(id)) {
                return `has duplicate ID ${id}`;
            }
            seen.add(id);
        }
        return null;
    }
};

// serverPayloadShape reduces a payload to what the backend's TestPayload
// carries: input always, data only when it is a non-empty object.
function serverPayloadShape(payload) {
    const shape = { input: payload.input === undefined ? null : payload.input };
    const data = payload.data;
    if (data !== null && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0) {
        shape.data = data;
    }
    return shape;
}

// idGroups returns, for every array the host path selects, the IDs its elements
// carry together with the trail the array was found at. `quests` selects one
// array; `quests[].tests` selects one array per quest.
function idGroups(pack, host, field) {
    return valuesAt(pack, host)
        .filter((site) => Array.isArray(site.value))
        .map((site) => ({
            ids: site.value.map((item) => (item === null || typeof item !== 'object' ? undefined : item[field])),
            trail: site.trail
        }));
}

// npcEntrySites iterates the pack's npc roster in sorted key order - the same
// order the backend validates in - so both halves point at the same entry.
function npcEntrySites(pack) {
    const npcs = pack ? pack.npcs : undefined;
    if (npcs === null || typeof npcs !== 'object' || Array.isArray(npcs)) {
        return [];
    }
    return Object.keys(npcs).sort().map((name, index) => ({ name, image: npcs[name], index }));
}

// NPC_ROSTER_KINDS are the rules that walk the npc roster rather than a value
// path. npcDefaultDefined and maxKeys look at the roster as a whole; the
// per-entry kinds take each entry site above.
const NPC_ROSTER_KINDS = new Set([
    'npcDefaultDefined', 'maxKeys',
    'npcNameRequired', 'npcNameMaxLength', 'npcNameCharset',
    'npcImageRequired', 'npcImageMaxLength', 'npcImagePath'
]);

// ============================================================================
// VALIDATION
// ============================================================================

// validatePack returns one entry per violation, so the author sees every
// problem with the pack at once instead of fixing one per save attempt. An
// empty array means the editor accepts the pack; the backend enforces the same
// set, which backend/quest/rules_parity_test.go pins.
function validatePack(pack) {
    const problems = [];

    for (const rule of PACK_RULES.rules) {
        if (rule.kind === 'contiguousIds' || rule.kind === 'uniqueIds') {
            for (const group of idGroups(pack, rule.host, rule.field)) {
                const problem = RULE_CHECKS[rule.kind](rule, group.ids);
                if (problem) {
                    problems.push({ ruleId: rule.id, message: `${renderTrail(group.trail)} ${problem}` });
                }
            }
            continue;
        }

        if (rule.kind === 'npcDefined') {
            const npcs = pack ? pack.npcs : null;
            for (const site of valuesAt(pack, rule.path)) {
                const speaker = site.value !== null && typeof site.value === 'object'
                    ? site.value.npc
                    : undefined;
                const declared = npcs !== null && typeof npcs === 'object' && !Array.isArray(npcs)
                    && Object.prototype.hasOwnProperty.call(npcs, speaker);
                if (!declared) {
                    problems.push({
                        ruleId: rule.id,
                        message: `${renderTrail(site.trail)} references npc "${speaker ?? ''}", which the pack does not declare`
                    });
                }
            }
            continue;
        }

        if (rule.kind === 'heroNpcDefined') {
            const npcs = pack ? pack.npcs : null;
            const hero = pack ? pack.hero_avatar : undefined;
            const declared = npcs !== null && typeof npcs === 'object' && !Array.isArray(npcs)
                && Object.prototype.hasOwnProperty.call(npcs, hero);
            if (!declared) {
                problems.push({
                    ruleId: rule.id,
                    message: `hero_avatar "${hero ?? ''}" is not a character declared in the npcs section`
                });
            }
            continue;
        }

        if (NPC_ROSTER_KINDS.has(rule.kind)) {
            if (rule.kind === 'npcDefaultDefined' || rule.kind === 'maxKeys') {
                const problem = RULE_CHECKS[rule.kind](rule, { value: pack ? pack.npcs : undefined });
                if (problem) {
                    problems.push({ ruleId: rule.id, message: `npcs ${problem}` });
                }
                continue;
            }
            for (const entry of npcEntrySites(pack)) {
                const problem = RULE_CHECKS[rule.kind](rule, entry);
                if (problem) {
                    problems.push({ ruleId: rule.id, message: `npcs[${entry.index}] ${problem}` });
                    break;
                }
            }
            continue;
        }

        for (const site of valuesAt(pack, rule.path)) {
            const problem = RULE_CHECKS[rule.kind](rule, site);
            if (problem) {
                problems.push({ ruleId: rule.id, message: `${renderTrail(site.trail)} ${problem}` });
            }
        }
    }

    return problems;
}

// renumberQuests gives every quest the ID of its position, counting from 1.
// The backend navigates quests by incrementing IDs and refuses a pack whose IDs
// are not contiguous, and the editor shows the ID as a locked field, so the
// number follows the list rather than the author's typing.
function renumberQuests(pack) {
    if (!pack || !Array.isArray(pack.quests)) {
        return pack;
    }
    pack.quests.forEach((quest, index) => {
        quest.id = index + 1;
    });
    return pack;
}

// nextFreeTestId proposes an ID for a new test case: one above the highest one
// already in the quest, so an added test does not collide with the existing set.
function nextFreeTestId(tests) {
    const used = (Array.isArray(tests) ? tests : [])
        .map((test) => (Number.isInteger(test.id) && test.id > 0 ? test.id : 0));
    return used.length ? Math.max(...used) + 1 : 1;
}

// parseTestId reads the ID the author typed for a test case. Anything that is
// not a positive whole number is refused instead of becoming 0, which is how a
// blank field used to collide with another blank one.
function parseTestId(text) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    const id = Number(raw);
    if (!raw || !Number.isInteger(id) || id < 1) {
        return { error: 'Test ID must be a whole number of 1 or more.' };
    }
    return { id };
}

// The block above is what backend/quest/rules_parity_test.go reads: it is a
// classic script, so the editor loads it as a global and a test runner can
// import it directly.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PACK_RULES,
        PACK_LIMITS,
        PACK_GENRE_PATTERN,
        DEFAULT_NPC_KEY,
        NPC_NAME_PATTERN,
        NPC_IMAGE_PREFIX,
        NPC_IMAGE_EXTENSIONS,
        validatePack,
        renumberQuests,
        nextFreeTestId,
        parseTestId
    };
}
