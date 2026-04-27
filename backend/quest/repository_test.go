package quest

import (
	"encoding/json"
	"testing"
)

func createValidPack() QuestPack {
	return QuestPack{
		ID: "test-pack",
		Meta: MetaData{
			Title:       "Test Pack",
			Description: "A test pack",
			Genre:       "test",
		},
		UILabels: UILabels{
			GrimoireTitle:          "Grimoire",
			HintButton:             "Hint",
			VerifyButton:           "Verify",
			MessageSuccess:         "Success",
			MessageFailure:         "Failure",
			PerfectScoreMessage:    "Perfect",
			PerfectScoreButtonText: "Next",
			BeginAdventureButton:   "Start",
		},
		Prologue: []string{"Intro"},
		Epilogue: []string{"Outro"},
		Quests: []Quest{
			{
				ID:              1,
				Title:           "Quest 1",
				DescriptionTask: "Do something",
				DescriptionLore: []string{"Lore"},
				Manual: Manual{
					DataModel:    "{}",
					RegoSnippet:  "package test",
					ExternalLink: "http://example.com",
				},
				Tests: []TestCase{
					{
						ID:              1,
						ExpectedOutcome: true,
						Payload: TestPayload{
							Input: map[string]any{"foo": "bar"},
						},
					},
				},
			},
		},
	}
}

func TestNewQuestRepository(t *testing.T) {
	repo := NewQuestRepository()
	if repo == nil {
		t.Fatal("NewQuestRepository returned nil")
	}
	if len(repo.packs) != 0 {
		t.Errorf("Expected empty repository, got %d packs", len(repo.packs))
	}
}

func TestLoadPack_Valid(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()
	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("Failed to marshal pack: %v", err)
	}

	err = repo.LoadPack("test-pack", data)
	if err != nil {
		t.Fatalf("LoadPack failed: %v", err)
	}

	loadedPack, ok := repo.GetPack("test-pack")
	if !ok {
		t.Fatal("GetPack returned false for loaded pack")
	}
	if loadedPack.ID != "test-pack" {
		t.Errorf("Expected pack ID 'test-pack', got '%s'", loadedPack.ID)
	}
	if len(loadedPack.Quests) != 1 {
		t.Errorf("Expected 1 quest, got %d", len(loadedPack.Quests))
	}
}

func TestLoadPack_InvalidJSON(t *testing.T) {
	repo := NewQuestRepository()
	err := repo.LoadPack("invalid", []byte("{invalid-json"))
	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}

func TestLoadPack_ValidationFailure(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()
	pack.Meta.Title = "" // Invalid: empty title

	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("Failed to marshal pack: %v", err)
	}

	err = repo.LoadPack("invalid-pack", data)
	if err == nil {
		t.Error("Expected validation error for empty title, got nil")
	}
}

func TestLoadPack_ValidationScenarios(t *testing.T) {
	tests := []struct {
		name        string
		modifyPack  func(*QuestPack)
		expectError bool
	}{
		{
			name:        "Valid Pack",
			modifyPack:  func(p *QuestPack) {},
			expectError: false,
		},
		{
			name: "Empty Pack Title",
			modifyPack: func(p *QuestPack) {
				p.Meta.Title = ""
			},
			expectError: true,
		},
		{
			name: "Pack Title Too Long",
			modifyPack: func(p *QuestPack) {
				p.Meta.Title = string(make([]byte, MaxPackTitle+1))
			},
			expectError: true,
		},
		{
			name: "Invalid Genre Characters",
			modifyPack: func(p *QuestPack) {
				p.Meta.Genre = "Sci-Fi & Fantasy" // & is not allowed
			},
			expectError: true,
		},
		{
			name: "Empty Prologue",
			modifyPack: func(p *QuestPack) {
				p.Prologue = []string{}
			},
			expectError: true,
		},
		{
			name: "Empty Epilogue",
			modifyPack: func(p *QuestPack) {
				p.Epilogue = []string{}
			},
			expectError: true,
		},
		{
			name: "No Quests",
			modifyPack: func(p *QuestPack) {
				p.Quests = []Quest{}
			},
			expectError: true,
		},
		{
			name: "Quest Missing Title",
			modifyPack: func(p *QuestPack) {
				p.Quests[0].Title = ""
			},
			expectError: true,
		},
		{
			name: "Quest Missing Task Description",
			modifyPack: func(p *QuestPack) {
				p.Quests[0].DescriptionTask = ""
			},
			expectError: true,
		},
		{
			name: "Quest No Tests",
			modifyPack: func(p *QuestPack) {
				p.Quests[0].Tests = []TestCase{}
			},
			expectError: true,
		},
		{
			name: "Quest Test Payload Too Large",
			modifyPack: func(p *QuestPack) {
				// Create a large payload
				largeInput := make(map[string]any)
				largeString := string(make([]byte, MaxTestPayloadBytes))
				largeInput["data"] = largeString
				p.Quests[0].Tests[0].Payload.Input = largeInput
			},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := NewQuestRepository()
			pack := createValidPack()
			tt.modifyPack(&pack)

			data, err := json.Marshal(pack)
			if err != nil {
				t.Fatalf("Failed to marshal pack: %v", err)
			}

			err = repo.LoadPack("test-pack", data)
			if tt.expectError && err == nil {
				t.Error("Expected validation error, got nil")
			}
			if !tt.expectError && err != nil {
				t.Errorf("Expected no error, got: %v", err)
			}
		})
	}
}

func TestGetQuestByID(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()
	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("Failed to marshal pack: %v", err)
	}

	if err := repo.LoadPack("test-pack", data); err != nil {
		t.Fatalf("LoadPack failed: %v", err)
	}

	// Test existing quest
	quest, ok := repo.GetQuestByID("test-pack", 1)
	if !ok {
		t.Error("GetQuestByID(1) returned false")
	}
	if quest != nil && quest.Title != "Quest 1" {
		t.Errorf("Expected quest title 'Quest 1', got '%s'", quest.Title)
	}

	// Test non-existing quest
	_, ok = repo.GetQuestByID("test-pack", 999)
	if ok {
		t.Error("GetQuestByID(999) returned true")
	}

	// Test non-existing pack
	_, ok = repo.GetQuestByID("non-existent", 1)
	if ok {
		t.Error("GetQuestByID on non-existent pack returned true")
	}
}

func TestGetAllPacks(t *testing.T) {
	repo := NewQuestRepository()
	pack1 := createValidPack()
	pack1.ID = "pack1"
	data1, _ := json.Marshal(pack1)

	pack2 := createValidPack()
	pack2.ID = "pack2"
	data2, _ := json.Marshal(pack2)

	repo.LoadPack("pack1", data1)
	repo.LoadPack("pack2", data2)

	packs := repo.GetAllPacks()
	if len(packs) != 2 {
		t.Errorf("Expected 2 packs, got %d", len(packs))
	}
}

func TestGetNumberOfPacks_Empty(t *testing.T) {
	repo := NewQuestRepository()
	if n := repo.GetNumberOfPacks(); n != 0 {
		t.Errorf("Expected 0 packs, got %d", n)
	}
}

func TestGetNumberOfPacks_AfterLoad(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()
	data, _ := json.Marshal(pack)

	if err := repo.LoadPack("test-pack", data); err != nil {
		t.Fatalf("LoadPack failed: %v", err)
	}

	if n := repo.GetNumberOfPacks(); n != 1 {
		t.Errorf("Expected 1 pack, got %d", n)
	}
}

func TestLoadPack_DuplicateQuestID(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()

	// Add a second quest with the same ID as the first
	duplicate := pack.Quests[0]
	pack.Quests = append(pack.Quests, duplicate)

	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("Failed to marshal pack: %v", err)
	}

	err = repo.LoadPack("dup-pack", data)
	if err == nil {
		t.Error("Expected error for duplicate quest ID, got nil")
	}
}

func TestLoadPack_OverwritesExistingPack(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()
	data, _ := json.Marshal(pack)

	if err := repo.LoadPack("test-pack", data); err != nil {
		t.Fatalf("First LoadPack failed: %v", err)
	}

	// Modify the pack and reload under the same ID
	pack.Meta.Title = "Updated Title"
	updatedData, _ := json.Marshal(pack)

	if err := repo.LoadPack("test-pack", updatedData); err != nil {
		t.Fatalf("Second LoadPack failed: %v", err)
	}

	loaded, ok := repo.GetPack("test-pack")
	if !ok {
		t.Fatal("GetPack returned false after reload")
	}
	if loaded.Meta.Title != "Updated Title" {
		t.Errorf("Expected updated title 'Updated Title', got %q", loaded.Meta.Title)
	}
}

func TestGetAllPacks_Empty(t *testing.T) {
	repo := NewQuestRepository()
	packs := repo.GetAllPacks()
	if packs == nil {
		t.Error("GetAllPacks should return non-nil slice for empty repository")
	}
	if len(packs) != 0 {
		t.Errorf("Expected 0 packs for empty repository, got %d", len(packs))
	}
}

func TestGetQuestByID_QuestMapLookup(t *testing.T) {
	repo := NewQuestRepository()
	pack := createValidPack()

	// Add a second quest with a different ID
	quest2 := pack.Quests[0]
	quest2.ID = 2
	quest2.Title = "Quest 2"
	pack.Quests = append(pack.Quests, quest2)

	data, _ := json.Marshal(pack)
	if err := repo.LoadPack("multi-quest", data); err != nil {
		t.Fatalf("LoadPack failed: %v", err)
	}

	q1, ok := repo.GetQuestByID("multi-quest", 1)
	if !ok || q1 == nil {
		t.Error("Expected to find quest 1")
	}

	q2, ok := repo.GetQuestByID("multi-quest", 2)
	if !ok || q2 == nil {
		t.Error("Expected to find quest 2")
	}
	if q2.Title != "Quest 2" {
		t.Errorf("Expected title 'Quest 2', got %q", q2.Title)
	}
}
