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

// ============================================================================
// VALIDATION
// ============================================================================
// The pack rules and their length limits are declared in rules.js, where the
// backend's rules_parity_test.go can compare them against the server's own
// checks. PACK_LIMITS, validatePack, renumberQuests, nextFreeTestId and
// parseTestId come from that file.

// ============================================================================
// GLOBAL STATE
// ============================================================================
let questData = null;

// openTestCase is the test case the modal is working on: 'add' with no
// position yet, or 'edit' with the position it sits at in the quest's list.
let openTestCase = null;

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    initializeMaxLengthAttributes();
});

function initializeEventListeners() {
    // Load buttons
    document.getElementById('loadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('loadBtnEmpty').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    // File input
    document.getElementById('fileInput').addEventListener('change', handleFileLoad);
    
    // Save button
    document.getElementById('saveBtn').addEventListener('click', saveJSON);
    
    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            switchView(view);
        });
    });
    
    // Add quest button
    document.getElementById('addQuestBtn').addEventListener('click', addQuest);
    
    // Add prologue/epilogue buttons
    document.getElementById('addPrologueBtn').addEventListener('click', addPrologueItem);
    document.getElementById('addEpilogueBtn').addEventListener('click', addEpilogueItem);
    
    // Modal buttons
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalSave').addEventListener('click', saveModalTest);

    // Validation report
    document.getElementById('validationReportClose').addEventListener('click', hideValidationReport);
    
    // Form change listeners for auto-save
    setupFormListeners();
}

// Initialize maxlength attributes on form fields from constants
function initializeMaxLengthAttributes() {
    // Meta fields
    const metaFields = {
        'meta-title': PACK_LIMITS.MaxPackTitle,
        'meta-description': PACK_LIMITS.MaxPackDescription,
        'meta-genre': PACK_LIMITS.MaxPackGenre,
        'meta-initial_objective': PACK_LIMITS.MaxPackObjective,
        'meta-final_objective': PACK_LIMITS.MaxPackObjective
    };
    
    // UI Labels fields
    const uiLabelsFields = {
        'ui_labels-grimoire_title': PACK_LIMITS.MaxUIGrimoireTitle,
        'ui_labels-hint_button': PACK_LIMITS.MaxUIHintButton,
        'ui_labels-verify_button': PACK_LIMITS.MaxUIVerifyButton,
        'ui_labels-verifying': PACK_LIMITS.MaxUIVerifying,
        'ui_labels-message_success': PACK_LIMITS.MaxUIMessageSuccess,
        'ui_labels-message_failure': PACK_LIMITS.MaxUIMessageFailure,
        'ui_labels-perfect_score_message': PACK_LIMITS.MaxUIPerfectScoreMessage,
        'ui_labels-perfect_score_button_text': PACK_LIMITS.MaxUIPerfectScoreButton,
        'ui_labels-begin_adventure_button': PACK_LIMITS.MaxUIBeginAdventureButton
    };
    
    // Apply maxlength to meta fields
    Object.entries(metaFields).forEach(([id, maxLength]) => {
        const el = document.getElementById(id);
        if (el) el.maxLength = maxLength;
    });
    
    // Apply maxlength to UI labels fields
    Object.entries(uiLabelsFields).forEach(([id, maxLength]) => {
        const el = document.getElementById(id);
        if (el) el.maxLength = maxLength;
    });
}

// ============================================================================
// FILE HANDLING
// ============================================================================
function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            questData = JSON.parse(e.target.result);
            loadEditor();
        } catch (error) {
            alert('Error parsing JSON file: ' + error.message);
        }
    };
    reader.readAsText(file);
}

function normalizeTestPayloads() {
    if (!questData || !Array.isArray(questData.quests)) return;

    questData.quests.forEach(quest => {
        if (!Array.isArray(quest.tests)) return;

        quest.tests.forEach(test => {
            if (!test.payload || typeof test.payload !== 'object' || Array.isArray(test.payload)) {
                test.payload = {};
            }
            if (test.data !== undefined && test.payload.data === undefined) {
                test.payload.data = test.data;
            }
            delete test.data;
            if (test.payload.input === undefined) {
                test.payload.input = {};
            }
        });
    });
}

function loadEditor() {
    normalizeTestPayloads();
    renumberQuests(questData);
    hideValidationReport();

    // Hide empty state, show editor
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('editorLayout').classList.remove('hidden');
    document.getElementById('saveBtn').disabled = false;
    
    // Update file indicator
    document.getElementById('fileIndicator').textContent = 'quests.json loaded';
    
    // Update quest count
    updateQuestCount();
    
    // Render all sections
    renderMeta();
    renderUILabels();
    renderPrologue();
    renderEpilogue();
    renderQuestNav();
    
    // Show meta view by default
    switchView('meta');
}

function saveJSON() {
    if (!questData) return;

    // The export is refused when the pack breaks a rule the backend enforces as
    // well; the report lists every problem at once instead of one per attempt.
    const problems = validatePack(questData);
    if (problems.length > 0) {
        renderValidationReport(problems);
        return;
    }
    hideValidationReport();

    renumberQuests(questData);
    
    // Create download
    const dataStr = JSON.stringify(questData, null, 4);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'quests.json';
    link.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// VIEW SWITCHING
// ============================================================================
function switchView(viewName) {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === viewName) {
            item.classList.add('active');
        }
    });
    
    // Update content views
    document.querySelectorAll('.content-view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }
}

function switchToQuest(questIndex) {
    // Update quest navigation
    document.querySelectorAll('#questNav .nav-item').forEach((item, idx) => {
        item.classList.toggle('active', idx === questIndex);
    });
    
    // Clone the quest template if needed
    let questView = document.getElementById(`view-quest-${questIndex}`);
    if (!questView) {
        const template = document.getElementById('view-quest-template');
        questView = template.cloneNode(true);
        questView.id = `view-quest-${questIndex}`;
        questView.style.display = '';
        document.querySelector('.main-content').appendChild(questView);

        // Initialize maxlength attributes for quest fields
        initializeQuestMaxLengthAttributes(questView);

        // Setup tab switching for this quest view
        setupQuestTabs(questView);

        // Form listeners only need to be attached once per view; attaching
        // them on every render would stack duplicate handlers.
        setupQuestFormListeners(questView, questIndex);

        // Setup delete button
        questView.querySelector('[data-field="deleteQuestBtn"]').addEventListener('click', () => {
            deleteQuest(questIndex);
        });

        // Setup add buttons
        questView.querySelector('[data-field="addLoreBtn"]').addEventListener('click', () => {
            addLoreItem(questIndex);
        });
        questView.querySelector('[data-field="addHintBtn"]').addEventListener('click', () => {
            addHintItem(questIndex);
        });
        questView.querySelector('[data-field="addTestBtn"]').addEventListener('click', () => {
            addTestItem(questIndex);
        });
        questView.querySelector('[data-field="addSupportModuleBtn"]').addEventListener('click', () => {
            addSupportModuleItem(questIndex);
        });
    }
    
    // Render quest data
    renderQuestDetails(questIndex, questView);
    
    // Show quest view
    document.querySelectorAll('.content-view').forEach(view => {
        view.classList.remove('active');
    });
    questView.classList.add('active');
}

// Initialize maxlength attributes for quest template fields
function initializeQuestMaxLengthAttributes(questView) {
    const questFields = {
        'quest-title': PACK_LIMITS.MaxQuestTitle,
        'quest-description_task': PACK_LIMITS.MaxQuestDescriptionTask,
        'quest-solution': PACK_LIMITS.MaxQuestSolution,
        'quest-template': PACK_LIMITS.MaxQuestTemplate,
        'quest-manual-data_model': PACK_LIMITS.MaxManualDataModel,
        'quest-manual-rego_snippet': PACK_LIMITS.MaxManualRegoSnippet,
        'quest-manual-external_link': PACK_LIMITS.MaxManualExternalLink
    };

    Object.entries(questFields).forEach(([field, maxLength]) => {
        const el = questView.querySelector(`[data-field="${field}"]`);
        if (el) el.maxLength = maxLength;
    });
}

function setupQuestTabs(questView) {
    const tabBtns = questView.querySelectorAll('.tab-btn');
    const tabContents = questView.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.dataset.tab === tabName) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================
function renderMeta() {
    if (!questData.meta) return;
    
    document.getElementById('meta-title').value = questData.meta.title || '';
    document.getElementById('meta-description').value = questData.meta.description || '';
    document.getElementById('meta-genre').value = questData.meta.genre || '';
    document.getElementById('meta-initial_objective').value = questData.meta.initial_objective || '';
    document.getElementById('meta-final_objective').value = questData.meta.final_objective || '';
}

function renderUILabels() {
    // Initialize ui_labels if it doesn't exist
    if (!questData.ui_labels) {
        questData.ui_labels = {
            grimoire_title: 'Policy Grimoire',
            hint_button: 'Ask Advisor',
            verify_button: 'Apply Policy',
            verifying: 'Verifying…',
            message_success: '',
            message_failure: '',
            perfect_score_message: '',
            perfect_score_button_text: '',
            begin_adventure_button: 'Begin Adventure'
        };
    }
    
    document.getElementById('ui_labels-grimoire_title').value = questData.ui_labels.grimoire_title || '';
    document.getElementById('ui_labels-hint_button').value = questData.ui_labels.hint_button || '';
    document.getElementById('ui_labels-verify_button').value = questData.ui_labels.verify_button || '';
    document.getElementById('ui_labels-verifying').value = questData.ui_labels.verifying || '';
    document.getElementById('ui_labels-message_success').value = questData.ui_labels.message_success || '';
    document.getElementById('ui_labels-message_failure').value = questData.ui_labels.message_failure || '';
    document.getElementById('ui_labels-perfect_score_message').value = questData.ui_labels.perfect_score_message || '';
    document.getElementById('ui_labels-perfect_score_button_text').value = questData.ui_labels.perfect_score_button_text || '';
    document.getElementById('ui_labels-begin_adventure_button').value = questData.ui_labels.begin_adventure_button || '';
}

function renderPrologue() {
    const container = document.getElementById('prologueList');
    container.innerHTML = '';
    
    if (!questData.prologue) questData.prologue = [];
    
    questData.prologue.forEach((item, index) => {
        const div = createListItem(item, () => removePrologueItem(index), (value) => {
            questData.prologue[index] = value;
        }, PACK_LIMITS.MaxPrologueItem);
        container.appendChild(div);
    });
}

function renderEpilogue() {
    const container = document.getElementById('epilogueList');
    container.innerHTML = '';
    
    if (!questData.epilogue) questData.epilogue = [];
    
    questData.epilogue.forEach((item, index) => {
        const div = createListItem(item, () => removeEpilogueItem(index), (value) => {
            questData.epilogue[index] = value;
        }, PACK_LIMITS.MaxEpilogueItem);
        container.appendChild(div);
    });
}

function renderQuestNav() {
    const container = document.getElementById('questNav');
    container.innerHTML = '';
    
    if (!questData.quests) questData.quests = [];
    
    questData.quests.forEach((quest, index) => {
        const navItem = document.createElement('a');
        navItem.href = '#';
        navItem.className = 'nav-item';
        
        // Security: Use DOM manipulation instead of innerHTML to prevent XSS
        const iconSpan = document.createElement('span');
        iconSpan.className = 'nav-icon';
        const icon = document.createElement('i');
        icon.className = 'fas fa-bullseye';
        iconSpan.appendChild(icon);
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'nav-label';
        // Security: Use textContent to safely render user-controlled data
        labelSpan.textContent = `${quest.id}: ${quest.title || 'Untitled'}`;
        
        navItem.appendChild(iconSpan);
        navItem.appendChild(labelSpan);
        navItem.addEventListener('click', (e) => {
            e.preventDefault();
            switchToQuest(index);
        });
        container.appendChild(navItem);
    });
    
    updateQuestCount();
}

function renderQuestDetails(questIndex, questView) {
    const quest = questData.quests[questIndex];

    // Update title
    questView.querySelector('[data-field="questViewTitle"]').textContent = `Quest ${quest.id}: ${quest.title || 'Untitled'}`;

    // Populate form fields
    questView.querySelector('[data-field="quest-id"]').value = quest.id || '';
    questView.querySelector('[data-field="quest-title"]').value = quest.title || '';
    questView.querySelector('[data-field="quest-query"]').value = quest.query || 'data.play.allow';
    questView.querySelector('[data-field="quest-description_task"]').value = quest.description_task || '';
    questView.querySelector('[data-field="quest-solution"]').value = quest.solution || '';
    questView.querySelector('[data-field="quest-apply_template"]').checked = quest.apply_template || false;
    questView.querySelector('[data-field="quest-template"]').value = quest.template || '';

    // Manual fields
    if (quest.manual) {
        questView.querySelector('[data-field="quest-manual-data_model"]').value = quest.manual.data_model || '';
        questView.querySelector('[data-field="quest-manual-rego_snippet"]').value = quest.manual.rego_snippet || '';
        questView.querySelector('[data-field="quest-manual-external_link"]').value = quest.manual.external_link || '';
    }

    // Render lore, hints, support modules, tests
    renderLore(questIndex, questView);
    renderHints(questIndex, questView);
    renderSupportModules(questIndex, questView);
    renderTests(questIndex, questView);
}

function renderLore(questIndex, questView) {
    const container = questView.querySelector('[data-field="loreList"]');
    container.innerHTML = '';

    const quest = questData.quests[questIndex];
    if (!quest.description_lore) quest.description_lore = [];

    quest.description_lore.forEach((item, index) => {
        const div = createListItem(item, () => removeLoreItem(questIndex, index), (value) => {
            questData.quests[questIndex].description_lore[index] = value;
        }, PACK_LIMITS.MaxQuestDescriptionLore);
        container.appendChild(div);
    });
}

function renderHints(questIndex, questView) {
    const container = questView.querySelector('[data-field="hintsList"]');
    container.innerHTML = '';

    const quest = questData.quests[questIndex];
    if (!quest.hints) quest.hints = [];

    quest.hints.forEach((item, index) => {
        const div = createListItem(item, () => removeHintItem(questIndex, index), (value) => {
            questData.quests[questIndex].hints[index] = value;
        }, PACK_LIMITS.MaxQuestHint);
        container.appendChild(div);
    });
}

function renderTests(questIndex, questView) {
    const container = questView.querySelector('[data-field="testsList"]');
    container.innerHTML = '';

    const quest = questData.quests[questIndex];
    if (!quest.tests) quest.tests = [];

    quest.tests.forEach((test, index) => {
        const div = createTestItem(test, questIndex, index);
        container.appendChild(div);
    });
}

// ============================================================================
// SUPPORT MODULES
// ============================================================================
// Support modules are hidden Rego modules compiled alongside the player's
// policy during verification. Each entry must be a complete Rego module
// with its own package declaration.

function renderSupportModules(questIndex, questView) {
    const container = questView.querySelector('[data-field="supportModulesList"]');
    container.innerHTML = '';

    const quest = questData.quests[questIndex];
    if (!Array.isArray(quest.support_modules)) quest.support_modules = [];

    quest.support_modules.forEach((module, index) => {
        const div = createCodeListItem(module, () => removeSupportModuleItem(questIndex, index), (value) => {
            questData.quests[questIndex].support_modules[index] = value;
        }, PACK_LIMITS.MaxQuestSupportModule);
        container.appendChild(div);
    });
}

function addSupportModuleItem(questIndex) {
    const quest = questData.quests[questIndex];
    if (!Array.isArray(quest.support_modules)) quest.support_modules = [];

    if (quest.support_modules.length >= PACK_LIMITS.MaxQuestSupportModules) {
        alert(`A quest can have at most ${PACK_LIMITS.MaxQuestSupportModules} support modules`);
        return;
    }

    quest.support_modules.push('package under_test\n\n');
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderSupportModules(questIndex, questView);
}

function removeSupportModuleItem(questIndex, moduleIndex) {
    questData.quests[questIndex].support_modules.splice(moduleIndex, 1);
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderSupportModules(questIndex, questView);
}

// ============================================================================
// HELPER FUNCTIONS FOR CREATING ELEMENTS
// ============================================================================
function createListItem(text, onRemove, onChange, maxLength, cssClass) {
    const div = document.createElement('div');
    div.className = 'list-item';
    
    const textarea = document.createElement('textarea');
    textarea.className = cssClass || 'form-control';
    textarea.rows = 2;
    textarea.value = text;
    if (maxLength) {
        textarea.maxLength = maxLength;
    }
    textarea.addEventListener('change', () => onChange(textarea.value));
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'list-item-actions';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    // Security: Static HTML content is safe
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.addEventListener('click', onRemove);
    
    actionsDiv.appendChild(removeBtn);
    div.appendChild(textarea);
    div.appendChild(actionsDiv);
    
    return div;
}

// Like createListItem, but rendered as a monospace code editor. Used for
// content that must be valid Rego, e.g. support modules.
function createCodeListItem(text, onRemove, onChange, maxLength) {
    return createListItem(text, onRemove, onChange, maxLength, 'form-control code-editor');
}

function createTestItem(test, questIndex, testIndex) {
    const div = document.createElement('div');
    div.className = 'test-item';
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'test-item-info';
    
    // Security: Use DOM manipulation instead of innerHTML to prevent XSS
    const labelDiv = document.createElement('div');
    labelDiv.className = 'test-item-label';
    // Security: Use textContent to safely render user-controlled test.id
    labelDiv.textContent = `Test ${test.id}`;
    
    const expectedDiv = document.createElement('div');
    expectedDiv.className = 'test-item-expected';
    // Security: Use textContent to safely render user-controlled expected_value
    expectedDiv.textContent = `Expected: ${JSON.stringify(test.expected_value)}`;
    
    infoDiv.appendChild(labelDiv);
    infoDiv.appendChild(expectedDiv);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'test-item-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    // Security: Static HTML content is safe
    editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editBtn.addEventListener('click', () => editTestItem(questIndex, testIndex));
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    // Security: Static HTML content is safe
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.addEventListener('click', () => removeTestItem(questIndex, testIndex));
    
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(removeBtn);
    div.appendChild(infoDiv);
    div.appendChild(actionsDiv);
    
    return div;
}

// ============================================================================
// ADD/REMOVE FUNCTIONS
// ============================================================================
function addPrologueItem() {
    if (!questData.prologue) questData.prologue = [];
    questData.prologue.push('');
    renderPrologue();
}

function removePrologueItem(index) {
    questData.prologue.splice(index, 1);
    renderPrologue();
}

function addEpilogueItem() {
    if (!questData.epilogue) questData.epilogue = [];
    questData.epilogue.push('');
    renderEpilogue();
}

function removeEpilogueItem(index) {
    questData.epilogue.splice(index, 1);
    renderEpilogue();
}

function addQuest() {
    if (!questData.quests) questData.quests = [];

    const newQuest = {
        // Seeded so the ID leads the exported object; renumberQuests below gives
        // it the real value, which is the quest's position.
        id: questData.quests.length + 1,
        title: 'New Quest',
        query: 'data.play.allow',
        description_lore: [],
        description_task: '',
        manual: {
            data_model: '',
            rego_snippet: '',
            external_link: ''
        },
        hints: [],
        solution: '',
        apply_template: false,
        template: '',
        support_modules: [],
        tests: []
    };
    
    questData.quests.push(newQuest);
    renumberQuests(questData);
    destroyQuestViews();
    renderQuestNav();
    switchToQuest(questData.quests.length - 1);
}

function deleteQuest(questIndex) {
    if (!confirm('Are you sure you want to delete this quest?')) return;

    questData.quests.splice(questIndex, 1);
    renumberQuests(questData);

    // A quest view is addressed by the quest's position and its buttons close
    // over that position, so every view goes with it: the remaining ones would
    // otherwise show and edit the wrong quest.
    destroyQuestViews();

    renderQuestNav();
    switchView('meta');
}

// destroyQuestViews drops the cloned quest views, which are rebuilt from the
// data the next time a quest is opened. The template itself stays.
function destroyQuestViews() {
    document.querySelectorAll('.main-content .quest-view').forEach((view) => {
        if (/^view-quest-\d+$/.test(view.id)) {
            view.remove();
        }
    });
}

function addLoreItem(questIndex) {
    const quest = questData.quests[questIndex];
    if (!quest.description_lore) quest.description_lore = [];
    quest.description_lore.push('');
    
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderLore(questIndex, questView);
}

function removeLoreItem(questIndex, loreIndex) {
    questData.quests[questIndex].description_lore.splice(loreIndex, 1);
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderLore(questIndex, questView);
}

function addHintItem(questIndex) {
    const quest = questData.quests[questIndex];
    if (!quest.hints) quest.hints = [];
    quest.hints.push('');
    
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderHints(questIndex, questView);
}

function removeHintItem(questIndex, hintIndex) {
    questData.quests[questIndex].hints.splice(hintIndex, 1);
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderHints(questIndex, questView);
}

function addTestItem(questIndex) {
    const quest = questData.quests[questIndex];
    if (!quest.tests) quest.tests = [];

    // Mirrors the backend MaxQuestTests cap: verification loops over
    // every test case per request, so an unbounded list is refused.
    if (quest.tests.length >= PACK_LIMITS.MaxQuestTests) {
        alert(`A quest can have at most ${PACK_LIMITS.MaxQuestTests} test cases`);
        return;
    }

    const newTest = {
        id: nextFreeTestId(quest.tests),
        payload: { input: {} },
        expected_value: false
    };

    openTestCase = { mode: 'add', questIndex, testIndex: null };
    showTestModal(newTest);
}

function editTestItem(questIndex, testIndex) {
    const test = questData.quests[questIndex].tests[testIndex];
    openTestCase = { mode: 'edit', questIndex, testIndex };
    showTestModal(test);
}

function removeTestItem(questIndex, testIndex) {
    if (!confirm('Are you sure you want to delete this test?')) return;
    
    questData.quests[questIndex].tests.splice(testIndex, 1);
    const questView = document.getElementById(`view-quest-${questIndex}`);
    renderTests(questIndex, questView);
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================
function showTestModal(test) {
    document.getElementById('modalTitle').textContent =
        openTestCase.mode === 'add' ? 'Add Test Case' : `Edit Test Case ${test.id}`;
    document.getElementById('modal-test-id').value = test.id ?? '';
    document.getElementById('modal-test-payload').value = JSON.stringify(test.payload?.input ?? {}, null, 2);
    document.getElementById('modal-test-data').value = JSON.stringify(test.payload?.data ?? {}, null, 2);
    document.getElementById('modal-test-expected').value = JSON.stringify(test.expected_value);

    hideTestModalError();
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
    hideTestModalError();
    openTestCase = null;
}

function showTestModalError(message) {
    const error = document.getElementById('modalError');
    error.textContent = message;
    error.classList.remove('hidden');
}

function hideTestModalError() {
    document.getElementById('modalError').classList.add('hidden');
}

// saveTest builds the test case from the modal fields. The ID is read as a
// whole number and refused if it is blank, not a number, or already used by
// another test of this quest - a blank ID used to become 0 and collide.
function saveModalTest() {
    if (!openTestCase) return;

    const quest = questData.quests[openTestCase.questIndex];
    const parsedId = parseTestId(document.getElementById('modal-test-id').value);
    if (parsedId.error) {
        showTestModalError(parsedId.error);
        return;
    }

    const clash = (quest.tests || []).find(
        (test, index) => index !== openTestCase.testIndex && test.id === parsedId.id
    );
    if (clash) {
        showTestModalError(`This quest already has a test case with ID ${parsedId.id}.`);
        return;
    }

    let test;
    try {
        const payload = {
            input: JSON.parse(document.getElementById('modal-test-payload').value || '{}')
        };
        const data = JSON.parse(document.getElementById('modal-test-data').value || '{}');
        if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0) {
            payload.data = data;
        }
        test = {
            id: parsedId.id,
            payload,
            expected_value: JSON.parse(document.getElementById('modal-test-expected').value)
        };
    } catch (error) {
        showTestModalError('The payload or expected value is not valid JSON: ' + error.message);
        return;
    }

    if (openTestCase.mode === 'add') {
        quest.tests.push(test);
    } else {
        quest.tests[openTestCase.testIndex] = test;
    }

    const questView = document.getElementById(`view-quest-${openTestCase.questIndex}`);
    renderTests(openTestCase.questIndex, questView);
    closeModal();
}

// ============================================================================
// FORM LISTENERS
// ============================================================================
function setupFormListeners() {
    // Meta fields
    ['title', 'description', 'genre', 'initial_objective', 'final_objective'].forEach(field => {
        const el = document.getElementById(`meta-${field}`);
        if (el) {
            el.addEventListener('change', () => {
                if (!questData.meta) questData.meta = {};
                questData.meta[field] = el.value;
            });
        }
    });
    
    // UI Labels fields
    ['grimoire_title', 'hint_button', 'verify_button', 'verifying', 'message_success', 'message_failure', 'perfect_score_message', 'perfect_score_button_text', 'begin_adventure_button'].forEach(field => {
        const el = document.getElementById(`ui_labels-${field}`);
        if (el) {
            el.addEventListener('change', () => {
                if (!questData.ui_labels) questData.ui_labels = {};
                questData.ui_labels[field] = el.value;
            });
        }
    });
}

function setupQuestFormListeners(questView, questIndex) {
    const fields = [
        { field: 'quest-title', key: 'title', type: 'text' },
        { field: 'quest-query', key: 'query', type: 'text' },
        { field: 'quest-description_task', key: 'description_task', type: 'text' },
        { field: 'quest-solution', key: 'solution', type: 'text' },
        { field: 'quest-apply_template', key: 'apply_template', type: 'checkbox' },
        { field: 'quest-template', key: 'template', type: 'text' }
    ];

    fields.forEach(({ field, key, type }) => {
        const el = questView.querySelector(`[data-field="${field}"]`);
        if (el) {
            el.addEventListener('change', () => {
                if (type === 'checkbox') {
                    questData.quests[questIndex][key] = el.checked;
                } else {
                    questData.quests[questIndex][key] = el.value;
                }

                // Update title in navigation if changed
                if (key === 'title') {
                    renderQuestNav();
                    questView.querySelector('[data-field="questViewTitle"]').textContent =
                        `Quest ${questData.quests[questIndex].id}: ${questData.quests[questIndex].title || 'Untitled'}`;
                }
            });
        }
    });

    // Manual fields
    const manualFields = [
        { field: 'quest-manual-data_model', key: 'data_model' },
        { field: 'quest-manual-rego_snippet', key: 'rego_snippet' },
        { field: 'quest-manual-external_link', key: 'external_link' }
    ];

    manualFields.forEach(({ field, key }) => {
        const el = questView.querySelector(`[data-field="${field}"]`);
        if (el) {
            el.addEventListener('change', () => {
                if (!questData.quests[questIndex].manual) {
                    questData.quests[questIndex].manual = {};
                }
                questData.quests[questIndex].manual[key] = el.value;
            });
        }
    });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function updateQuestCount() {
    const count = questData.quests ? questData.quests.length : 0;
    document.getElementById('questCount').textContent = `${count} quest${count !== 1 ? 's' : ''}`;
}

// ============================================================================
// VALIDATION REPORT
// ============================================================================

// renderValidationReport lists the pack problems in the panel under the top
// bar, so an author with several problems sees them in one pass. Text only: the
// pack content is user input and never reaches the panel as markup.
function renderValidationReport(problems) {
    const panel = document.getElementById('validationReport');
    const list = document.getElementById('validationReportList');

    document.getElementById('validationReportTitle').textContent =
        problems.length === 1
            ? 'The pack has one problem that the backend would refuse'
            : `The pack has ${problems.length} problems that the backend would refuse`;

    list.textContent = '';
    for (const problem of problems) {
        const item = document.createElement('li');
        item.textContent = problem.message;
        list.appendChild(item);
    }
    panel.classList.remove('hidden');
}

function hideValidationReport() {
    document.getElementById('validationReport').classList.add('hidden');
}
