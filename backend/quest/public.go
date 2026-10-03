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

package quest

// PublicQuest is the client-facing view of a quest. It deliberately omits
// the solution, the hint texts, and the hidden support modules: revealing
// them is a deliberate player action served by dedicated API endpoints, so
// the bulk pack payload must never contain them. HintsCount and HasSolution
// describe what is available so the UI can render button states without the
// content itself.
type PublicQuest struct {
	ID                int        `json:"id"`
	Title             string     `json:"title"`
	DescriptionLore   []string   `json:"description_lore"`
	DescriptionTask   string     `json:"description_task"`
	Manual            Manual     `json:"manual"`
	HintsCount        int        `json:"hints_count"`
	HasSolution       bool       `json:"has_solution"`
	HasSupportModules bool       `json:"has_support_modules"`
	Tests             []TestCase `json:"tests"`
	ApplyTemplate     bool       `json:"apply_template"`
	Template          string     `json:"template"`
	Query             string     `json:"query"`
}

// PublicQuestPack is the client-facing view of a quest pack. It mirrors
// QuestPack except that quests are serialized through PublicQuest.
type PublicQuestPack struct {
	ID       string        `json:"id"`
	Meta     MetaData      `json:"meta"`
	UILabels UILabels      `json:"ui_labels"`
	Prologue []string      `json:"prologue"`
	Epilogue []string      `json:"epilogue"`
	Quests   []PublicQuest `json:"quests"`
}

// PublicView returns the client-facing projection of the quest.
func (q *Quest) PublicView() PublicQuest {
	return PublicQuest{
		ID:                q.ID,
		Title:             q.Title,
		DescriptionLore:   q.DescriptionLore,
		DescriptionTask:   q.DescriptionTask,
		Manual:            q.Manual,
		HintsCount:        len(q.Hints),
		HasSolution:       q.Solution != "",
		HasSupportModules: len(q.SupportModules) > 0,
		Tests:             q.Tests,
		ApplyTemplate:     q.ApplyTemplate,
		Template:          q.Template,
		Query:             q.Query,
	}
}

// PublicView returns the client-facing projection of the pack.
func (p *QuestPack) PublicView() PublicQuestPack {
	quests := make([]PublicQuest, len(p.Quests))
	for i := range p.Quests {
		quests[i] = p.Quests[i].PublicView()
	}
	return PublicQuestPack{
		ID:       p.ID,
		Meta:     p.Meta,
		UILabels: p.UILabels,
		Prologue: p.Prologue,
		Epilogue: p.Epilogue,
		Quests:   quests,
	}
}

// HintByID returns the 1-based indexed hint text. It reports false when the
// index is out of range, so callers can answer with a 404.
func (q *Quest) HintByID(hintID int) (string, bool) {
	if hintID < 1 || hintID > len(q.Hints) {
		return "", false
	}
	return q.Hints[hintID-1], true
}
