# Quests Structure

The `quests/<theme>/quests.json` files define the tutorial quests the player must solve. Here's the structure:

## Top-Level Structure

- `version`: Format marker for the pack. Must be `2`; a pack that carries no
  version key or a different one is refused at load. See "Format Version and
  Migration" below.
- `meta`: Object containing quest metadata
  - `title`: The overall quest/adventure title
  - `description`: Brief description of the quest scenario
  - `genre`: Theme identifier (e.g., "cyberpunk", "noir", ...)
  - `initial_objective`: Message displayed at the start of the adventure
  - `final_objective`: Message displayed after completing all quests
- `ui_labels`: Object containing theme-specific UI labels and messages
  - `grimoire_title`: Title shown above the code editor (e.g., "ICE Protocol Editor", "Case Files")
  - `hint_button`: Text for the hint/advisor button (e.g., "Query NetWatch", "Call Veronica")
  - `verify_button`: Text for the verify/submit button (e.g., "Execute ICE", "Close the Case")
  - `verifying`: Text shown on the verify button while the policy is being evaluated (e.g., "Executing ICE...", "Closing the Case..."). Falls back to "Verifying…" when not set
  - `message_success`: Message displayed when a quest is completed successfully
  - `message_failure`: Message displayed when a quest fails
  - `perfect_score_button_text`: Text for the button shown when a perfect score is achieved
  - `perfect_score_message`: Message displayed when the player achieves a perfect score (all quests completed without errors). Supports markdown formatting and newlines (`\n`) for multi-paragraph text.
- `npcs`: Object naming the characters that speak the pack's narrative. Each
  key is a character the lore entries can quote, and its value is the image
  that portrait uses, a path inside the pack that must start with `assets/`
  and end in `.png`, `.jpg`, `.jpeg` or `.webp` (svg stays out: it can carry
  script content and the image lands in an `<img>`). Keys start with a letter
  and continue with letters, digits, `_` and `-`.
  - `default_npc`: Required. The speaker shown for screens that have no lore
    entry of their own - the quest task, the hints, the modals - and the
    speaker the migration tool gives to lines of pre-v2 packs, whose single
    quest-giver image speaks every line.
  - The game shows the portrait of whichever lore entry is on screen, so a
    quest's dialogue reads as a small cast; see `description_lore` below.
- `hero_npc`: Required. Names the roster entry that is the player character:
    the page header's avatar shows that entry's portrait, and the entry is
    free to speak in lore like any other character. Must be a key of `npcs`.
- `background_image`: Required. The image behind the game screens, a path
    inside the pack under its `assets/` folder (same rules as a roster
    portrait path).
- `prologue`: Array of lore entries (see quest lore entries below) containing the introductory narrative
- `epilogue`: Array of lore entries containing the concluding narrative
- `quests`: Array of individual `quest` objects (see below)

## Quest Object Structure

Each element in the `quests` array is a `quest` specification with the following fields:

- `id`: Numeric quest identifier
- `title`: Short imperative name for the quest
- `description_lore`: Array of lore entries describing the scene. Each entry is an object:
  - `npc`: The speaking character, a key of the pack's `npcs` section; while the entry is on screen the game shows that character's portrait
  - `text`: The narrative fluff text the character speaks
- `description_task`: Short instructions describing what the player must do
- `manual`: An object containing reference documentation for the quest with the following fields:
  - `data_model`: Markdown-formatted text describing the input data fields available for this quest (e.g., `input.user.id`, `data.registry`)
  - `rego_snippet`: Markdown-formatted text explaining the Rego concepts and syntax required for this quest, may include code examples
  - `external_link`: Optional URL to external documentation or resources (may be an empty string)
- `hints`: Ordered array of text hints to assist the player
- `solution`: The correct Rego policy code that solves the quest. It may either include its own `package` declaration or omit it; `cmd/solutionverifier` derives the package from the quest's `query` (e.g. `data.play.allow` → package `play`) when it is missing.
- `query`: Required string field specifying the Rego query path to evaluate (e.g., `"data.play.allow"`). This determines what the examiner queries when checking the user's Rego code against the test cases.
- `apply_template`: Boolean flag that controls whether the template code should replace the contents of the Policy Grimoire code window
- `template`: String containing the template code to be displayed in the Policy Grimoire code window.
  - **Behavior**: If `apply_template` is set to `true`, the code in the Policy Grimoire code window is replaced with the `template` code. If `template` is defined but `apply_template` is not set to `true`, the current content of the editor is retained.
- `support_modules`: Optional array of hidden Rego modules that are compiled alongside the player's policy during verification. Intended for quests where the player writes test rules against a fixed "policy under test". Each entry must be a complete Rego module including its own `package` declaration (e.g., `"package under_test"`). Support modules are referenced from the player's code via their package path (e.g., `data.under_test.allow`) and share the same evaluation context as the player's policy, including the unsafe-builtins block. Compile errors in a support module are reported with `file: "support_<n>.rego"`, where `<n>` is the 1-based position in the array.
  - **Player visibility**: On quests with support modules, the puzzle-piece button in the Policy Grimoire toolbar becomes active and opens a "Support Modules" modal that shows each module's source (with its `data.<package>` path) so the player can read the contract they are coding against. On quests without support modules the button stays visible but disabled.
- `tests`: Array of automated validation scenarios, each with:
  - `id`: Numeric test identifier
  - `payload`: Object reflecting the `input` data received by Rego
  - `data`: (Optional) Object containing external data accessible via `data.*` in Rego policies
  - `expected_value`: any result that the policy must return

  Test cases live in the pack file only. The pack payload the browser loads (`GET
  /api/packs/{packId}`) omits them; the test modal fetches them from
  `GET /api/packs/{packId}/quests/{questId}/test-payload` when it opens. That endpoint is a
  convenience layer rather than a secrecy boundary: it answers `payload`, `data` and
  `expected_value` to any client that asks. Tests are a checking device, not hidden content.

## String Length Validation Limits

All text fields in the quest JSON structure are validated against maximum length limits. These limits are enforced server-side when validating a quest pack and in the quest editor HTML forms.

### Pack Metadata Limits

- `meta.title`: 100 characters
- `meta.description`: 500 characters
- `meta.genre`: 50 characters (alphanumeric and basic punctuation only)
- `meta.initial_objective`: 500 characters (optional field)
- `meta.final_objective`: 500 characters (optional field)

### UI Labels Limits

- `ui_labels.grimoire_title`: 100 characters
- `ui_labels.hint_button`: 100 characters
- `ui_labels.verify_button`: 100 characters
- `ui_labels.verifying`: 100 characters
- `ui_labels.message_success`: 200 characters
- `ui_labels.message_failure`: 200 characters
- `ui_labels.perfect_score_message`: 1000 characters
- `ui_labels.perfect_score_button_text`: 100 characters
- `ui_labels.begin_adventure_button`: 100 characters

### Narrative Content Limits

- `prologue` lore entries: 2000 characters of text each (at least one entry required)
- `epilogue` lore entries: 2000 characters of text each (at least one entry required)

### Character Limits

- `npcs`: maximum of 50 characters
- `npcs` keys: 64 characters, and they must match the key pattern above
- `npcs` image paths: 500 characters

### Quest Field Limits

- `quest.title`: 100 characters
- `quest.description_task`: 1000 characters
- `quest.description_lore` lore entries: 2000 characters of text each (at least one entry required)
- `quest.hints` array items: 500 characters each (optional)
- `quest.solution`: 5000 characters (optional)
- `quest.template`: 10000 characters (optional)
- `quest.support_modules`: maximum of 5 modules per quest, 10000 characters each (optional)
- `quest.tests`: maximum of 100 test cases per quest (each is evaluated on every verification request)
- `quest.query`: No explicit limit (required field)

### Manual Field Limits

- `quest.manual.data_model`: 2000 characters
- `quest.manual.rego_snippet`: 5000 characters
- `quest.manual.external_link`: 500 characters

### Test Payload Limits

- `test.payload`: 50KB maximum (total JSON serialized size; enforced server-side during quest pack validation and in the quest editor HTML forms)

## Format Version and Migration

Packs declare their format with a top-level `version` key. This build writes
and reads version `2`, the format that introduces the `npcs` section and the
`{npc, text}` lore entries.

A pack without a `version` key - the pre-v2 format, where prologue, epilogue
and quest lore are plain string arrays and a single quest-giver image speaks
every line - is refused when the server scans its pack directories: the log
names the pack and points at the migration tool, and the pack simply never
loads. The quest editor refuses the same packs on open, for the same reason.

**Migrating a pack** rewrites its `quests.json` in place:

```bash
go run ./cmd/questmigrate -dir <pack-dir|parent-dir> [-dry-run]
```

`-dir` takes one pack directory or a directory whose immediate
subdirectories are packs. The original file is kept beside the rewritten one
as `quests.json.v1.bak`. Every narrative string becomes a lore entry spoken
by `default_npc`, whose portrait is set to the pack's `npc-questgiver.png` -
the image the old format showed for every line - so a migrated pack plays
exactly as it did before. The migration also gives the pack its media
pointers: the hero entry (`npcs.hero -> assets/hero-avatar.png`, the avatar
the old format showed) named by `hero_npc`, and `background_image` pointing
at the pack's `bg-adventure.jpg`. The pack is loaded through the server's own
validation before anything is written, and a pack that still does not load
is left untouched. The run is idempotent: a pack already at the current
format is skipped, a pack that predates the media pointers is healed by
adding exactly those keys, so rerunning after a partial batch costs nothing.
`-dry-run` reports what would change without writing.

After migrating, authors can rename `default_npc` references and declare real
characters with the quest editor's Characters view.
