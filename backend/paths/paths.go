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

// Package paths centralizes the on-disk frontend layout the server reads at
// runtime, relative to the working directory (mirrored by the Dockerfile's
// COPY frontend ./frontend).
package paths

const (
	// AdventureDir is the static adventure UI served by the SPA handler.
	AdventureDir = "frontend/adventure"
	// QuestsDir contains the quest packs loaded at startup and served on
	// demand.
	QuestsDir = "frontend/quests"
	// SharedCSSDir contains the CSS files shared by all quest packs.
	SharedCSSDir = "frontend/shared/css"
)
