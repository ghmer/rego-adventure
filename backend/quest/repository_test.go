package quest

import (
	"encoding/json"
	"testing"
)

func createValidPack() QuestPack {
	return QuestPack{
		ID: "test-pack",
		Meta: QuestMeta{
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
				Manual: QuestManual{
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
