# Quest Editor QA Checklist

The quest editor is a static tool: `docu/quest-editor/` holds one HTML file, two
scripts and a stylesheet, and it loads no dependencies. Two automated checks
cover the pack rules and the structural helpers:

```bash
node --test docu/quest-editor/          # the editor's own rule and fixture tests
go test ./backend/quest/                # rules_parity_test.go, the same fixture
                                        # packs through the server's load path
```

Everything below is what a browser does with them and has to be looked at after
a change to `app.js`, `index.html`, `rules.js` or `styles.css`.

## 1. A new quest cannot be exported empty

1. Load a `quests.json`, then press **Add Quest**.
2. The new quest appears in the sidebar numbered by its position.
3. Press **Save**. Nothing downloads and the panel under the top bar lists the
   pack's problems, naming the quest: the task is empty, there is no lore entry,
   there is no test case.
4. Fill those three in and press **Save** again: `quests.json` downloads.
5. The panel's **×** dismisses the list without exporting.

## 2. Deleting the middle quest of three

1. With three quests in the pack, delete the second one.
2. The sidebar lists two quests, numbered 1 and 2.
3. Open the second entry: it shows the quest that used to be third, and its
   fields hold that quest's text, not the deleted quest's.
4. Open the first entry: unchanged.
5. **Save**: the exported file numbers its quests 1 and 2 with no gap.

## 3. Quest IDs follow the list

1. The **Quest ID** box on every quest is read-only and shows the quest's
   position; typing in it does nothing.
2. Adding a quest and deleting a quest renumber the remaining quests, so the
   exported pack never has a gap or a duplicate ID.

## 4. Test cases

1. **Add Test Case** on a quest proposes an ID that quest does not use yet.
2. Clear the ID and press **Save**: the modal says the ID must be a whole number
   of 1 or more and no test case is added.
3. Enter an ID another test of the same quest already has: the modal names the
   collision and nothing changes.
4. Enter invalid JSON in the input or data field: the modal reports the JSON
   error and keeps the previous test cases.
5. Edit an existing test case and change its ID to one that is already used: the
   same collision message. Changing it to a free ID renames it and the list still
   shows the same number of test cases.
6. A test case whose ID is 0 in a loaded pack still exports: the backend accepts
   it. The editor only refuses to create one.

## 5. The exported pack loads

1. Export a pack with the steps above.
2. Put the file in a pack directory:
   `mkdir -p frontend/quests/editor-qa && cp ~/Downloads/quests.json frontend/quests/editor-qa/quests.json`
3. `go run .` and open the start screen: `editor-qa` is listed, and the adventure
   can be started and played through to the epilogue.
4. A pack that the editor refused must not get this far: copy a rejected pack in,
   restart the server and the start screen logs the pack load problem and keeps
   serving the remaining packs.
5. Remove the scratch directory again.

