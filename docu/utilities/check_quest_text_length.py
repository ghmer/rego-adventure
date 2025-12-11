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

#!/usr/bin/env python3
"""
Quest Text Length Checker
Scans all quest JSON files and reports text exceeding 200 characters.
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any


def check_text_length(text: str, max_length: int = 200) -> bool:
    """Check if text exceeds the maximum length."""
    return len(text) > max_length


def check_quest_file(theme: str, file_path: Path, max_length: int = 200) -> List[Dict[str, Any]]:
    """
    Check a single quest file for text exceeding max_length.
    
    Returns a list of violations with details.
    """
    violations = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Check prologue
        if 'prologue' in data and isinstance(data['prologue'], list):
            for idx, text in enumerate(data['prologue']):
                if check_text_length(text, max_length):
                    violations.append({
                        'theme': theme,
                        'location': 'prologue',
                        'index': idx,
                        'field': f'prologue[{idx}]',
                        'length': len(text),
                        'preview': text[:100] + '...' if len(text) > 100 else text
                    })
        
        # Check epilogue
        if 'epilogue' in data and isinstance(data['epilogue'], list):
            for idx, text in enumerate(data['epilogue']):
                if check_text_length(text, max_length):
                    violations.append({
                        'theme': theme,
                        'location': 'epilogue',
                        'index': idx,
                        'field': f'epilogue[{idx}]',
                        'length': len(text),
                        'preview': text[:100] + '...' if len(text) > 100 else text
                    })
        
        # Check quests
        if 'quests' in data and isinstance(data['quests'], list):
            for quest in data['quests']:
                quest_id = quest.get('id', 'unknown')
                quest_title = quest.get('title', 'Unknown Quest')
                
                # Check description_lore
                if 'description_lore' in quest and isinstance(quest['description_lore'], list):
                    for idx, text in enumerate(quest['description_lore']):
                        if check_text_length(text, max_length):
                            violations.append({
                                'theme': theme,
                                'location': 'quest',
                                'quest_id': quest_id,
                                'quest_title': quest_title,
                                'field': f'description_lore[{idx}]',
                                'length': len(text),
                                'preview': text[:100] + '...' if len(text) > 100 else text
                            })
    
    except FileNotFoundError:
        print(f"Warning: File not found: {file_path}")
    except json.JSONDecodeError as e:
        print(f"Warning: Invalid JSON in {file_path}: {e}")
    except Exception as e:
        print(f"Warning: Error processing {file_path}: {e}")
    
    return violations


def main():
    """Main function to scan all quest files."""
    # Define themes and base path
    themes = ['cyberpunk', 'fantasy', 'noir', 'scifi', 'thriller']
    base_path = Path('frontend/quests')
    max_length = 200
    
    print("=" * 80)
    print("QUEST TEXT LENGTH CHECKER")
    print("=" * 80)
    print(f"Checking for text exceeding {max_length} characters...\n")
    
    all_violations = []
    
    # Check each theme
    for theme in themes:
        quest_file = base_path / theme / 'quests.json'
        
        if not quest_file.exists():
            print(f"Skipping {theme}: quests.json not found")
            continue
        
        violations = check_quest_file(theme, quest_file, max_length)
        all_violations.extend(violations)
    
    # Report results
    if not all_violations:
        print("All text is within the 200 character limit.")
    else:
        print(f"Found {len(all_violations)} violation(s):\n")
        print("-" * 80)
        
        for i, violation in enumerate(all_violations, 1):
            print(f"\n{i}. Theme: {violation['theme'].upper()}")
            
            if violation['location'] == 'quest':
                print(f"   Quest ID: {violation['quest_id']}")
                print(f"   Quest Title: {violation['quest_title']}")
            
            print(f"   Field: {violation['field']}")
            print(f"   Length: {violation['length']} characters (exceeds by {violation['length'] - max_length})")
            print(f"   Preview: {violation['preview']}")
            print("-" * 80)
        
        print(f"\nTotal violations: {len(all_violations)}")
    
    print("\n" + "=" * 80)
    print("Scan complete!")
    print("=" * 80)


if __name__ == '__main__':
    main()