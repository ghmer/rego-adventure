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

package logger

import (
	"log/slog"
	"testing"
)

func TestSetup_AcceptsKnownLevels(t *testing.T) {
	for _, level := range []string{"", "debug", "INFO", "warn", "error"} {
		if err := Setup(level); err != nil {
			t.Errorf("Setup(%q) returned error: %v", level, err)
		}
	}
	t.Cleanup(func() { slog.SetDefault(slog.Default()) })
}

func TestSetup_RejectsUnknownLevels(t *testing.T) {
	for _, level := range []string{"infos", "verbose", "trace", "ture"} {
		if err := Setup(level); err == nil {
			t.Errorf("Setup(%q) should have failed", level)
		}
	}
}
