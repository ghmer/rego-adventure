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
// GLOBAL STATE
// ============================================================================
let questData = null;
let currentQuestIndex = -1;
let currentModalTest = null;

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
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
    
    // Form change listeners for auto-save
    setupFormListeners();
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

function loadEditor() {
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
    
    // Collect current form data
    collectFormData();
    
    // Validate
    if (!validateData()) {
        alert('Please fix validation errors before saving');
        return;
    }
    
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
    currentQuestIndex = questIndex;
    const quest = questData.quests[questIndex];
    
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
        
        // Setup tab switching for this quest view
        setupQuestTabs(questView, questIndex);
        
        // Setup delete button
        questView.querySelector('#deleteQuestBtn').addEventListener('click', () => {
            deleteQuest(questIndex);
        });
        
        // Setup add buttons
        questView.querySelector('#addLoreBtn').addEventListener('click', () => {
            addLoreItem(questIndex);
        });
        questView.querySelector('#addHintBtn').addEventListener('click', () => {
            addHintItem(questIndex);
        });
        questView.querySelector('#addTestBtn').addEventListener('click', () => {
            addTestItem(questIndex);
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

function setupQuestTabs(questView, questIndex) {
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
                if (content.id === `tab-${tabName}`) {
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
        });
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
        });
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
    questView.querySelector('#questViewTitle').textContent = `Quest ${quest.id}: ${quest.title || 'Untitled'}`;
    
    // Populate form fields
    questView.querySelector('#quest-id').value = quest.id || '';
    questView.querySelector('#quest-title').value = quest.title || '';
    questView.querySelector('#quest-query').value = quest.query || 'data.play.allow';
    questView.querySelector('#quest-description_task').value = quest.description_task || '';
    questView.querySelector('#quest-solution').value = quest.solution || '';
    questView.querySelector('#quest-apply_template').checked = quest.apply_template || false;
    questView.querySelector('#quest-template').value = quest.template || '';
    
    // Manual fields
    if (quest.manual) {
        questView.querySelector('#quest-manual-data_model').value = quest.manual.data_model || '';
        questView.querySelector('#quest-manual-rego_snippet').value = quest.manual.rego_snippet || '';
        questView.querySelector('#quest-manual-external_link').value = quest.manual.external_link || '';
    }
    
    // Setup change listeners
    setupQuestFormListeners(questView, questIndex);
    
    // Render lore, hints, tests
    renderLore(questIndex, questView);
    renderHints(questIndex, questView);
    renderTests(questIndex, questView);
}

function renderLore(questIndex, questView) {
    const container = questView.querySelector('#loreList');
    container.innerHTML = '';
    
    const quest = questData.quests[questIndex];
    if (!quest.description_lore) quest.description_lore = [];
    
    quest.description_lore.forEach((item, index) => {
        const div = createListItem(item, () => removeLoreItem(questIndex, index), (value) => {
            questData.quests[questIndex].description_lore[index] = value;
        });
        container.appendChild(div);
    });
}

function renderHints(questIndex, questView) {
    const container = questView.querySelector('#hintsList');
    container.innerHTML = '';
    
    const quest = questData.quests[questIndex];
    if (!quest.hints) quest.hints = [];
    
    quest.hints.forEach((item, index) => {
        const div = createListItem(item, () => removeHintItem(questIndex, index), (value) => {
            questData.quests[questIndex].hints[index] = value;
        });
        container.appendChild(div);
    });
}

function renderTests(questIndex, questView) {
    const container = questView.querySelector('#testsList');
    container.innerHTML = '';
    
    const quest = questData.quests[questIndex];
    if (!quest.tests) quest.tests = [];
    
    quest.tests.forEach((test, index) => {
        const div = createTestItem(test, questIndex, index);
        container.appendChild(div);
    });
}

// ============================================================================
// HELPER FUNCTIONS FOR CREATING ELEMENTS
// ============================================================================
function createListItem(text, onRemove, onChange) {
    const div = document.createElement('div');
    div.className = 'list-item';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'form-control';
    textarea.rows = 2;
    textarea.value = text;
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
    // Security: Use textContent to safely render user-controlled expected_outcome
    expectedDiv.textContent = `Expected: ${test.expected_outcome}`;
    
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
        tests: []
    };
    
    questData.quests.push(newQuest);
    renderQuestNav();
    switchToQuest(questData.quests.length - 1);
}

function deleteQuest(questIndex) {
    if (!confirm('Are you sure you want to delete this quest?')) return;
    
    questData.quests.splice(questIndex, 1);
    
    // Remove the quest view
    const questView = document.getElementById(`view-quest-${questIndex}`);
    if (questView) questView.remove();
    
    // Re-render navigation and switch to meta view
    renderQuestNav();
    switchView('meta');
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
    
    const newTest = {
        id: quest.tests.length + 1,
        payload: {},
        data: {},
        expected_outcome: false
    };
    
    currentModalTest = { questIndex, testIndex: -1, test: newTest };
    showTestModal(newTest);
}

function editTestItem(questIndex, testIndex) {
    const test = questData.quests[questIndex].tests[testIndex];
    currentModalTest = { questIndex, testIndex, test };
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
    document.getElementById('modal-test-id').value = test.id || '';
    document.getElementById('modal-test-payload').value = JSON.stringify(test.payload || {}, null, 2);
    document.getElementById('modal-test-data').value = JSON.stringify(test.data || {}, null, 2);
    document.getElementById('modal-test-expected').value = String(test.expected_outcome);
    
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
    currentModalTest = null;
}

function saveModalTest() {
    if (!currentModalTest) return;
    
    try {
        const test = {
            id: parseInt(document.getElementById('modal-test-id').value) || 0,
            payload: JSON.parse(document.getElementById('modal-test-payload').value || '{}'),
            data: JSON.parse(document.getElementById('modal-test-data').value || '{}'),
            expected_outcome: document.getElementById('modal-test-expected').value === 'true'
        };
        
        const { questIndex, testIndex } = currentModalTest;
        
        if (testIndex === -1) {
            // Adding new test
            questData.quests[questIndex].tests.push(test);
        } else {
            // Editing existing test
            questData.quests[questIndex].tests[testIndex] = test;
        }
        
        const questView = document.getElementById(`view-quest-${questIndex}`);
        renderTests(questIndex, questView);
        closeModal();
    } catch (error) {
        alert('Error saving test: ' + error.message);
    }
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
    ['grimoire_title', 'hint_button', 'verify_button', 'message_success', 'message_failure', 'perfect_score_message', 'perfect_score_button_text', 'begin_adventure_button'].forEach(field => {
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
        { id: 'quest-id', key: 'id', type: 'number' },
        { id: 'quest-title', key: 'title', type: 'text' },
        { id: 'quest-query', key: 'query', type: 'text' },
        { id: 'quest-description_task', key: 'description_task', type: 'text' },
        { id: 'quest-solution', key: 'solution', type: 'text' },
        { id: 'quest-apply_template', key: 'apply_template', type: 'checkbox' },
        { id: 'quest-template', key: 'template', type: 'text' }
    ];
    
    fields.forEach(({ id, key, type }) => {
        const el = questView.querySelector(`#${id}`);
        if (el) {
            el.addEventListener('change', () => {
                if (type === 'number') {
                    questData.quests[questIndex][key] = parseInt(el.value) || 0;
                } else if (type === 'checkbox') {
                    questData.quests[questIndex][key] = el.checked;
                } else {
                    questData.quests[questIndex][key] = el.value;
                }
                
                // Update title in navigation if changed
                if (key === 'title' || key === 'id') {
                    renderQuestNav();
                    questView.querySelector('#questViewTitle').textContent = 
                        `Quest ${questData.quests[questIndex].id}: ${questData.quests[questIndex].title || 'Untitled'}`;
                }
            });
        }
    });
    
    // Manual fields
    const manualFields = [
        { id: 'quest-manual-data_model', key: 'data_model' },
        { id: 'quest-manual-rego_snippet', key: 'rego_snippet' },
        { id: 'quest-manual-external_link', key: 'external_link' }
    ];
    
    manualFields.forEach(({ id, key }) => {
        const el = questView.querySelector(`#${id}`);
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

function collectFormData() {
    // Data is collected in real-time via change listeners
    // This function is kept for compatibility
}

function validateData() {
    if (!questData) return false;
    
    // Validate quest IDs are unique
    const ids = questData.quests.map(q => q.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
        alert('Quest IDs must be unique!');
        return false;
    }
    
    // Validate test IDs within each quest
    for (let i = 0; i < questData.quests.length; i++) {
        const quest = questData.quests[i];
        if (quest.tests && quest.tests.length > 0) {
            const testIds = quest.tests.map(t => t.id);
            const uniqueTestIds = new Set(testIds);
            if (testIds.length !== uniqueTestIds.size) {
                alert(`Quest ${quest.id}: Test IDs must be unique!`);
                return false;
            }
        }
    }
    
    return true;
}