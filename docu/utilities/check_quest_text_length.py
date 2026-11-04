#!/usr/bin/env python3
# Copyright 2025 Mario Enrico Ragucci
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Quest Text Length Checker

Scans all quest pack JSON files and reports text fields that exceed the
limits defined in backend/quest/constants.go — the single source of
truth also enforced by the server at pack load time and (via the
constants sync test) by the quest editor. Limits are parsed from the Go
file at run time, so this tool cannot drift from the backend.

Lengths are Unicode code points, matching the backend's
utf8.RuneCountInString-based validation.
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Regex for "MaxXxx = 123" constant definitions in constants.go
GO_CONST_RE = re.compile(r'^\s*(Max\w+)\s*=\s*(\d+)\s*$', re.MULTILINE)


def load_limits(constants_path: Path) -> Dict[str, int]:
    """Parse the Max* length constants from backend/quest/constants.go."""
    limits: Dict[str, int] = {}
    try:
        content = constants_path.read_text(encoding='utf-8')
    except OSError as e:
        print(f"ERROR: Cannot read {constants_path}: {e}", file=sys.stderr)
        sys.exit(1)

    for match in GO_CONST_RE.finditer(content):
        limits[match.group(1)] = int(match.group(2))

    if not limits:
        print(f"ERROR: No Max* constants found in {constants_path}", file=sys.stderr)
        sys.exit(1)
    return limits


def check_field(
    violations: List[Dict[str, Any]],
    limits: Dict[str, int],
    limit_name: str,
    theme: str,
    location: str,
    field: str,
    text: Optional[str],
    index: Optional[int] = None,
    quest_info: Optional[Dict[str, Any]] = None,
) -> None:
    """Append a violation entry when text exceeds its field's limit."""
    if not isinstance(text, str):
        return

    max_length = limits[limit_name]
    if len(text) <= max_length:
        return

    entry: Dict[str, Any] = {
        'theme': theme,
        'location': location,
        'index': index,
        'field': field,
        'limit': max_length,
        'limit_name': limit_name,
        'length': len(text),
        'preview': text[:100] + '...' if len(text) > 100 else text,
    }
    if quest_info:
        entry.update(quest_info)
    violations.append(entry)


def check_quest_file(theme: str, file_path: Path, limits: Dict[str, int]) -> List[Dict[str, Any]]:
    """Check a single quest pack file against the parsed limits."""
    violations: List[Dict[str, Any]] = []

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Warning: File not found: {file_path}")
        return violations
    except json.JSONDecodeError as e:
        print(f"Warning: Invalid JSON in {file_path}: {e}")
        return violations

    # Pack meta
    meta = data.get('meta', {})
    check_field(violations, limits, 'MaxPackTitle', theme, 'meta', 'meta.title', meta.get('title'))
    check_field(violations, limits, 'MaxPackDescription', theme, 'meta', 'meta.description', meta.get('description'))
    check_field(violations, limits, 'MaxPackGenre', theme, 'meta', 'meta.genre', meta.get('genre'))
    check_field(violations, limits, 'MaxPackObjective', theme, 'meta', 'meta.initial_objective', meta.get('initial_objective'))
    check_field(violations, limits, 'MaxPackObjective', theme, 'meta', 'meta.final_objective', meta.get('final_objective'))

    # UI labels
    label_limits = {
        'grimoire_title': 'MaxUIGrimoireTitle',
        'hint_button': 'MaxUIHintButton',
        'verify_button': 'MaxUIVerifyButton',
        'verifying': 'MaxUIVerifying',
        'message_success': 'MaxUIMessageSuccess',
        'message_failure': 'MaxUIMessageFailure',
        'perfect_score_message': 'MaxUIPerfectScoreMessage',
        'perfect_score_button_text': 'MaxUIPerfectScoreButton',
        'begin_adventure_button': 'MaxUIBeginAdventureButton',
    }
    ui_labels = data.get('ui_labels', {})
    for label_key, limit_name in label_limits.items():
        check_field(violations, limits, limit_name, theme, 'ui_labels', f'ui_labels.{label_key}', ui_labels.get(label_key))

    # Prologue / epilogue
    for list_name, limit_name in (('prologue', 'MaxPrologueItem'), ('epilogue', 'MaxEpilogueItem')):
        entries = data.get(list_name, [])
        if isinstance(entries, list):
            for idx, text in enumerate(entries):
                check_field(violations, limits, limit_name, theme, list_name, f'{list_name}[{idx}]', text, idx)

    # Quests
    for quest in data.get('quests', []):
        if not isinstance(quest, dict):
            continue
        quest_id = quest.get('id', 'unknown')
        quest_title = quest.get('title', 'Unknown Quest')
        quest_info = {'quest_id': quest_id, 'quest_title': quest_title}

        check_field(violations, limits, 'MaxQuestTitle', theme, 'quest', 'title', quest.get('title'), None, quest_info)
        check_field(violations, limits, 'MaxQuestDescriptionTask', theme, 'quest', 'description_task',
                    quest.get('description_task'), None, quest_info)

        for key, limit_name in (('description_lore', 'MaxQuestDescriptionLore'), ('hints', 'MaxQuestHint'),
                                ('support_modules', 'MaxQuestSupportModule')):
            entries = quest.get(key, [])
            if isinstance(entries, list):
                for idx, text in enumerate(entries):
                    check_field(violations, limits, limit_name, theme, 'quest', f'{key}[{idx}]', text, idx, quest_info)

        check_field(violations, limits, 'MaxQuestSolution', theme, 'quest', 'solution', quest.get('solution'), None, quest_info)
        check_field(violations, limits, 'MaxQuestTemplate', theme, 'quest', 'template', quest.get('template'), None, quest_info)

        manual = quest.get('manual', {})
        check_field(violations, limits, 'MaxManualDataModel', theme, 'quest', 'manual.data_model',
                    manual.get('data_model'), None, quest_info)
        check_field(violations, limits, 'MaxManualRegoSnippet', theme, 'quest', 'manual.rego_snippet',
                    manual.get('rego_snippet'), None, quest_info)
        check_field(violations, limits, 'MaxManualExternalLink', theme, 'quest', 'manual.external_link',
                    manual.get('external_link'), None, quest_info)

    return violations


def main():
    """Scan all quest pack files and report limit violations."""
    # The tool lives in docu/utilities; the project root is two levels up.
    project_root = Path(__file__).parent.parent.parent
    constants_path = project_root / 'backend' / 'quest' / 'constants.go'
    quests_base_dir = project_root / 'frontend' / 'quests'

    limits = load_limits(constants_path)

    print("=" * 80)
    print("QUEST TEXT LENGTH CHECKER")
    print("=" * 80)
    print(f"Field limits parsed from {constants_path.relative_to(project_root)} "
          f"({len(limits)} constants)\n")

    quest_files = sorted(quests_base_dir.glob('*/quests.json'))
    if not quest_files:
        print(f"No quests.json files found in {quests_base_dir}")
        return

    all_violations: List[Dict[str, Any]] = []
    for quest_file in quest_files:
        theme = quest_file.parent.name
        all_violations.extend(check_quest_file(theme, quest_file, limits))

    if not all_violations:
        print("All text is within the limits defined in constants.go.")
    else:
        print(f"Found {len(all_violations)} violation(s):\n")
        print("-" * 80)

        for i, v in enumerate(all_violations, 1):
            print(f"\n{i}. Theme: {v['theme'].upper()}")
            if v['location'] == 'quest':
                print(f"   Quest ID: {v['quest_id']}")
                print(f"   Quest Title: {v['quest_title']}")
            print(f"   Field: {v['field']} ({v['limit_name']}: {v['limit']})")
            print(f"   Length: {v['length']} characters (exceeds by {v['length'] - v['limit']})")
            print(f"   Preview: {v['preview']}")
            print("-" * 80)

        print(f"\nTotal violations: {len(all_violations)}")

    print("\n" + "=" * 80)
    print("Scan complete!")
    print("=" * 80)

    # Non-zero exit makes the tool usable as a pre-commit/pack check
    sys.exit(1 if all_violations else 0)


if __name__ == '__main__':
    main()
