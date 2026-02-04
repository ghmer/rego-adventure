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

import (
	"encoding/json"
	"fmt"
)

// QuestRepository handles loading and accessing quests.
type QuestRepository struct {
	packs map[string]*QuestPack
}

// NewQuestRepository creates a new repository.
func NewQuestRepository() *QuestRepository {
	return &QuestRepository{
		packs: make(map[string]*QuestPack),
	}
}

// LoadPack loads a quest pack from the provided bytes.
func (r *QuestRepository) LoadPack(id string, questData []byte) error {
	var pack QuestPack
	if err := json.Unmarshal(questData, &pack); err != nil {
		return fmt.Errorf("failed to parse quests json for %s: %w", id, err)
	}
	pack.ID = id

	// Validate quest pack structure and content
	if err := validateQuestPack(&pack); err != nil {
		return fmt.Errorf("validation failed for pack %s: %w", id, err)
	}

	// Build quest map for fast lookup
	pack.questMap = make(map[int]*Quest, len(pack.Quests))
	for i := range pack.Quests {
		pack.questMap[pack.Quests[i].ID] = &pack.Quests[i]
	}

	r.packs[id] = &pack
	return nil
}

// GetPack returns a specific quest pack by its ID.
func (r *QuestRepository) GetPack(id string) (*QuestPack, bool) {
	pack, ok := r.packs[id]
	return pack, ok
}

// GetAllPacks returns all available quest packs.
func (r *QuestRepository) GetAllPacks() []*QuestPack {
	packs := make([]*QuestPack, 0, len(r.packs))
	for _, p := range r.packs {
		packs = append(packs, p)
	}
	return packs
}

// GetNumberOfPacks returns the number of available quest packs.
func (r *QuestRepository) GetNumberOfPacks() int {
	return len(r.packs)
}

// GetQuestByID returns a specific quest by its ID from a specific pack.
func (r *QuestRepository) GetQuestByID(packID string, questID int) (*Quest, bool) {
	pack, ok := r.packs[packID]
	if !ok {
		return nil, false
	}
	quest, ok := pack.questMap[questID]
	return quest, ok
}
