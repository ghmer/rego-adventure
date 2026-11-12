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

// Runs the editor's own validation against the same fixture packs the backend
// is run against in backend/quest/rules_parity_test.go. A pack must be refused
// by both sides or accepted by both sides; a pack the editor accepts and the
// backend refuses is a pack the author exports and then cannot load.
//
// Run with: node --test docu/quest-editor/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    PACK_RULES,
    validatePack,
    renumberQuests,
    nextFreeTestId,
    parseTestId
} = require('./rules.js');

const FIXTURE_PATH = path.join(__dirname, 'testdata', 'pack-validation-fixtures.json');
const fixtureFile = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

// ============================================================================
// FIXTURE CONSTRUCTION (same generator forms the Go side expands)
// ============================================================================

function expandValue(value) {
    if (Array.isArray(value)) {
        return value.map(expandValue);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'count')) {
        const repeated = [];
        for (let i = 0; i < value.count; i += 1) {
            repeated.push(expandValue(value.value));
        }
        return repeated;
    }
    if (Object.prototype.hasOwnProperty.call(value, '$repeatChars')) {
        return (value.char || 'x').repeat(value.$repeatChars);
    }
    const expanded = {};
    for (const [key, item] of Object.entries(value)) {
        expanded[key] = expandValue(item);
    }
    return expanded;
}

function applyPatch(pack, patch) {
    const segments = patch.path.split('.');
    let container = pack;

    for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        const last = i === segments.length - 1;
        const index = /^\d+$/.test(segment) ? Number(segment) : null;

        if (index !== null) {
            if (!Array.isArray(container)) {
                throw new Error(`fixture path ${patch.path}: ${segments.slice(0, i).join('.')} is not an array`);
            }
            if (index < 0 || index >= container.length) {
                throw new Error(`fixture path ${patch.path}: index ${index} out of range`);
            }
            if (last) {
                if (patch.remove) {
                    container.splice(index, 1);
                    return;
                }
                container[index] = expandValue(patch.value);
                return;
            }
            container = container[index];
            continue;
        }

        if (container === null || typeof container !== 'object') {
            throw new Error(`fixture path ${patch.path}: ${segments.slice(0, i + 1).join('.')} is not an object`);
        }
        if (last) {
            if (patch.remove) {
                throw new Error(`fixture path ${patch.path}: remove needs an array position`);
            }
            container[segment] = expandValue(patch.value);
            return;
        }
        container = container[segment];
    }
    throw new Error(`fixture path ${patch.path} walks off the end of the pack`);
}

function buildPack(patches) {
    const pack = structuredClone(fixtureFile.basePack);
    for (const patch of patches || []) {
        applyPatch(pack, patch);
    }
    return pack;
}

function caseLabel(testCase) {
    return testCase.name || testCase.ruleId;
}

// ============================================================================
// PARITY WITH THE BACKEND'S VERDICTS
// ============================================================================

test('every rule has a fixture pack and every fixture pack has a rule', () => {
    const declared = PACK_RULES.rules.map((rule) => rule.id);
    const targeted = fixtureFile.cases
        .filter((testCase) => testCase.ruleId)
        .map((testCase) => testCase.ruleId);

    const uniqueSorted = (list) => Array.from(new Set(list)).sort();
    assert.deepEqual(
        uniqueSorted(targeted),
        uniqueSorted(declared),
        'the fixture packs and the rule list must name the same rules'
    );
});

test('the base pack validates cleanly', () => {
    assert.deepEqual(validatePack(fixtureFile.basePack), []);
});

for (const testCase of fixtureFile.cases) {
    test(`pack "${caseLabel(testCase)}" is ${testCase.valid ? 'accepted' : 'refused'} by the editor`, () => {
        const problems = validatePack(buildPack(testCase.patches));

        if (testCase.valid) {
            assert.deepEqual(problems, [], 'the editor refuses a pack the backend accepts');
            return;
        }
        const reported = problems.map((problem) => problem.ruleId);
        assert.ok(
            reported.includes(testCase.ruleId),
            `the editor reports ${JSON.stringify(reported)}, expected ${testCase.ruleId}`
        );
    });
}

// ============================================================================
// STRUCTURAL EDITS
// ============================================================================

test('deleting the middle quest leaves IDs the backend loads', () => {
    const pack = structuredClone(fixtureFile.basePack);
    assert.equal(pack.quests.length, 3);

    pack.quests.splice(1, 1);
    renumberQuests(pack);

    assert.deepEqual(pack.quests.map((quest) => quest.id), [1, 2]);
    const expected = fixtureFile.cases.find(
        (testCase) => testCase.name === 'deleting the middle quest leaves contiguous IDs'
    );
    assert.deepEqual(pack, buildPack(expected.patches));
    assert.deepEqual(validatePack(pack), []);
});

test('adding a quest renumbers by position', () => {
    const pack = structuredClone(fixtureFile.basePack);
    pack.quests.push({ ...pack.quests[0], id: 99 });
    renumberQuests(pack);

    assert.deepEqual(pack.quests.map((quest) => quest.id), [1, 2, 3, 4]);
});

test('a quest added without content is refused, not exported', () => {
    const pack = structuredClone(fixtureFile.basePack);
    pack.quests.push({
        id: 4,
        title: '',
        description_lore: [],
        description_task: '',
        query: '',
        tests: []
    });
    renumberQuests(pack);

    const reported = validatePack(pack).map((problem) => problem.ruleId);
    for (const ruleId of ['quest_title_required', 'quest_task_required', 'quest_lore_min_items', 'quest_query_required', 'quest_tests_min_items']) {
        assert.ok(reported.includes(ruleId), `${ruleId} should be reported for a fresh quest`);
    }
});

// ============================================================================
// TEST CASE IDs
// ============================================================================

test('a blank or non-numeric test ID is refused instead of becoming zero', () => {
    for (const text of ['', '  ', 'abc', '12x', '-3', '1.5', '0']) {
        assert.ok(parseTestId(text).error, `${JSON.stringify(text)} should be refused`);
    }
    assert.equal(parseTestId('7').id, 7);
    assert.equal(parseTestId(' 7 ').id, 7);
});

test('a new test proposes an ID the existing ones do not use', () => {
    const tests = [{ id: 1 }, { id: 4 }, { id: 0 }];
    assert.equal(nextFreeTestId(tests), 5);
    assert.equal(nextFreeTestId([]), 1);
});

test('duplicate test IDs inside one quest are refused', () => {
    const pack = structuredClone(fixtureFile.basePack);
    pack.quests[0].tests = [
        { id: 3, payload: { input: {} }, expected_value: true },
        { id: 3, payload: { input: {} }, expected_value: false }
    ];
    const reported = validatePack(pack).map((problem) => problem.ruleId);
    assert.ok(reported.includes('quest_test_ids_unique'));
});

// ============================================================================
// RULE DEFINITIONS
// ============================================================================

test('every rule has a kind the validator implements', () => {
    const kinds = new Set([
        'nonEmpty', 'maxLength', 'minItems', 'maxItems', 'charset',
        'urlScheme', 'maxJsonBytes', 'contiguousIds', 'uniqueIds'
    ]);
    const ids = new Set();
    for (const rule of PACK_RULES.rules) {
        assert.ok(kinds.has(rule.kind), `rule ${rule.id} has unknown kind ${rule.kind}`);
        assert.ok(!ids.has(rule.id), `rule id ${rule.id} is declared twice`);
        ids.add(rule.id);

        if (rule.kind === 'contiguousIds' || rule.kind === 'uniqueIds') {
            assert.ok(rule.host && rule.field, `rule ${rule.id} needs host and field`);
            continue;
        }
        assert.ok(rule.path, `rule ${rule.id} needs a path`);
    }
});

test('the length rules name limits that exist', () => {
    for (const rule of PACK_RULES.rules) {
        if (!['maxLength', 'maxItems', 'maxJsonBytes'].includes(rule.kind)) {
            continue;
        }
        assert.equal(
            typeof PACK_RULES.limits[rule.limit],
            'number',
            `rule ${rule.id} names the missing limit ${rule.limit}`
        );
    }
});
