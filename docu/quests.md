# Quests Structure

The `quests/<theme>/quests.json` files define the tutorial quests the player must solve. Here's the structure:

## Top-Level Structure

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
  - `message_success`: Message displayed when a quest is completed successfully
  - `message_failure`: Message displayed when a quest fails
  - `perfect_score_button_text`: Text for the button shown when a perfect score is achieved
  - `perfect_score_message`: Message displayed when the player achieves a perfect score (all quests completed without errors). Supports markdown formatting and newlines (`\n`) for multi-paragraph text.
- `prologue`: Array of strings containing the introductory narrative
- `epilogue`: Array of strings containing the concluding narrative
- `quests`: Array of individual `quest` objects (see below)

## Quest Object Structure

Each element in the `quests` array is a `quest` specification with the following fields:

- `id`: Numeric quest identifier
- `title`: Short imperative name for the quest
- `description_lore`: Array of strings with narrative fluff text describing the scene
- `description_task`: Short instructions describing what the player must do
- `manual`: An object containing reference documentation for the quest with the following fields:
  - `data_model`: Markdown-formatted text describing the input data fields available for this quest (e.g., `input.user.id`, `data.registry`)
  - `rego_snippet`: Markdown-formatted text explaining the Rego concepts and syntax required for this quest, may include code examples
  - `external_link`: Optional URL to external documentation or resources (may be an empty string)
- `hints`: Ordered array of text hints to assist the player
- `solution`: The correct Rego policy code that solves the quest
- `query`: Required string field specifying the Rego query path to evaluate (e.g., `"data.play.allow"`). This determines what the examiner queries when checking the user's Rego code against the test cases.
- `apply_template`: Boolean flag that controls whether the template code should replace the contents of the Policy Grimoire code window
- `template`: String containing the template code to be displayed in the Policy Grimoire code window.
  - **Behavior**: If `apply_template` is set to `true`, the code in the Policy Grimoire code window is replaced with the `template` code. If `template` is defined but `apply_template` is not set to `true`, the current content of the editor is retained.
- `tests`: Array of automated validation scenarios, each with:
  - `id`: Numeric test identifier
  - `payload`: Object reflecting the `input` data received by Rego
  - `data`: (Optional) Object containing external data accessible via `data.*` in Rego policies
  - `expected_outcome`: Boolean result that the policy must return

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
- `ui_labels.message_success`: 200 characters
- `ui_labels.message_failure`: 200 characters
- `ui_labels.perfect_score_message`: 1000 characters
- `ui_labels.perfect_score_button_text`: 100 characters
- `ui_labels.begin_adventure_button`: 100 characters

### Narrative Content Limits

- `prologue` array items: 2000 characters each (at least one item required)
- `epilogue` array items: 2000 characters each (at least one item required)

### Quest Field Limits

- `quest.title`: 100 characters
- `quest.description_task`: 1000 characters
- `quest.description_lore` array items: 2000 characters each (at least one item required)
- `quest.hints` array items: 500 characters each (optional)
- `quest.solution`: 5000 characters (optional)
- `quest.template`: 10000 characters (optional)
- `quest.query`: No explicit limit (required field)

### Manual Field Limits

- `quest.manual.data_model`: 2000 characters
- `quest.manual.rego_snippet`: 5000 characters
- `quest.manual.external_link`: 500 characters

### Test Payload Limits

- `test.payload`: 50KB maximum (JSON serialized size)
- `test.payload.input`: 50KB maximum (JSON serialized size)
- `test.payload.data`: 50KB maximum (JSON serialized size)

