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
	"strings"
	"testing"
)

func TestQuest_PublicView_StripsSecrets(t *testing.T) {
	q := createValidQuest()
	q.SupportModules = []string{"package helpers\n\nsecret_rule := true\n"}

	view := q.PublicView()

	if view.ID != q.ID || view.Title != q.Title {
		t.Errorf("expected narrative fields to be preserved, got id=%d title=%q", view.ID, view.Title)
	}
	if view.HintsCount != 2 {
		t.Errorf("expected hints_count=2, got %d", view.HintsCount)
	}
	if !view.HasSolution {
		t.Error("expected has_solution=true for quest with solution")
	}
	if len(view.Tests) != len(q.Tests) {
		t.Errorf("expected tests to be preserved, got %d", len(view.Tests))
	}

	data, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("failed to marshal public view: %v", err)
	}
	body := string(data)
	for _, secret := range []string{"solution code", "Hint 1", "secret_rule"} {
		if strings.Contains(body, secret) {
			t.Errorf("public view leaks secret %q", secret)
		}
	}
	for _, key := range []string{"\"solution\"", "\"hints\"", "\"support_modules\""} {
		if strings.Contains(body, key) {
			t.Errorf("public view must not contain key %s", key)
		}
	}
	for _, key := range []string{"\"hints_count\":2", "\"has_solution\":true"} {
		if !strings.Contains(body, key) {
			t.Errorf("public view missing derived key %s, got %s", key, body)
		}
	}
}

func TestQuest_PublicView_EmptyHintsAndSolution(t *testing.T) {
	q := createValidQuest()
	q.Hints = nil
	q.Solution = ""

	view := q.PublicView()

	if view.HintsCount != 0 {
		t.Errorf("expected hints_count=0, got %d", view.HintsCount)
	}
	if view.HasSolution {
		t.Error("expected has_solution=false for quest without solution")
	}
}

func TestQuestPack_PublicView_MapsAllQuests(t *testing.T) {
	pack := createValidQuestPack()
	second := createValidQuest()
	second.ID = 2
	second.Hints = nil
	second.Solution = ""
	second.Title = "Second Quest"
	pack.Quests = append(pack.Quests, second)

	view := pack.PublicView()

	if view.ID != pack.ID || view.Meta.Title != pack.Meta.Title {
		t.Errorf("expected pack metadata to be preserved, got id=%q title=%q", view.ID, view.Meta.Title)
	}
	if len(view.Prologue) != len(pack.Prologue) || len(view.Epilogue) != len(pack.Epilogue) {
		t.Error("expected narrative lists to be preserved")
	}
	if len(view.Quests) != 2 {
		t.Fatalf("expected 2 quests, got %d", len(view.Quests))
	}
	if view.Quests[0].HintsCount != 2 || !view.Quests[0].HasSolution {
		t.Errorf("expected first quest to keep hints/solution counts, got %d/%v",
			view.Quests[0].HintsCount, view.Quests[0].HasSolution)
	}
	if view.Quests[1].Title != "Second Quest" || view.Quests[1].HintsCount != 0 || view.Quests[1].HasSolution {
		t.Errorf("expected second quest to expose counts only, got %q %d/%v",
			view.Quests[1].Title, view.Quests[1].HintsCount, view.Quests[1].HasSolution)
	}
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("failed to marshal public pack view: %v", err)
	}
	if strings.Contains(string(data), "solution code") {
		t.Error("public pack view leaks a solution")
	}
}

func TestQuest_HintByID(t *testing.T) {
	q := createValidQuest()

	for _, tc := range []struct {
		hintID    int
		want      string
		wantFound bool
	}{
		{hintID: 1, want: "Hint 1", wantFound: true},
		{hintID: 2, want: "Hint 2", wantFound: true},
		{hintID: 0, wantFound: false},
		{hintID: 3, wantFound: false},
		{hintID: -1, wantFound: false},
	} {
		hint, found := q.HintByID(tc.hintID)
		if found != tc.wantFound {
			t.Errorf("HintByID(%d) found=%v, want %v", tc.hintID, found, tc.wantFound)
		}
		if found && hint != tc.want {
			t.Errorf("HintByID(%d) = %q, want %q", tc.hintID, hint, tc.want)
		}
	}
}

func TestQuest_HintByID_NoHints(t *testing.T) {
	q := createValidQuest()
	q.Hints = nil

	if _, found := q.HintByID(1); found {
		t.Error("expected HintByID(1) to report false for quest without hints")
	}
}
