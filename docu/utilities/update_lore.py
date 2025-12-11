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
Update quest JSON files from lore markdown files.

This script:
1. Finds all lore-{genre}.md files in frontend/quests/*/
2. Parses each markdown file using HTML comment markers
3. Extracts meta-level prologue/epilogue and quest-level prologue/description_lore/epilogue
4. Updates the corresponding quests.json files
5. Preserves all other JSON fields unchanged
"""

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def parse_lore_markdown(markdown_path: Path) -> Tuple[Optional[List[str]], Optional[List[str]], Dict[int, Dict[str, List[str]]]]:
    """
    Parse a lore markdown file and extract meta-level and quest-level lore entries.
    
    Uses HTML comment markers to precisely identify sections:
    - <!-- META_PROLOGUE_START/END --> for meta-level prologue
    - <!-- META_EPILOGUE_START/END --> for meta-level epilogue
    - <!-- LORE_ENTRY_START quest_id={id} --> marks the start of a quest's lore
    - <!-- PROLOGUE_START/END --> for quest-level prologue
    - <!-- DESCRIPTION_LORE_START/END --> for quest-level description_lore
    - <!-- EPILOGUE_START/END --> for quest-level epilogue
    - <!-- LORE_ENTRY_END quest_id={id} --> marks the end of a quest's lore
    
    Args:
        markdown_path: Path to the lore markdown file
        
    Returns:
        Tuple of (meta_prologue, meta_epilogue, quest_lore_dict)
        - meta_prologue: List of prologue paragraphs or None
        - meta_epilogue: List of epilogue paragraphs or None
        - quest_lore_dict: Dictionary mapping quest_id to dict with 'prologue', 'description_lore', 'epilogue' keys
    """
    try:
        with open(markdown_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"ERROR: Failed to read {markdown_path}: {e}", file=sys.stderr)
        return (None, None, {})
    
    # Extract meta-level prologue
    meta_prologue = None
    meta_prologue_match = re.search(r'<!-- META_PROLOGUE_START -->(.*?)<!-- META_PROLOGUE_END -->', content, re.DOTALL)
    if meta_prologue_match:
        meta_prologue = extract_paragraphs(meta_prologue_match.group(1), 'PROLOGUE_PARAGRAPH')
    
    # Extract meta-level epilogue
    meta_epilogue = None
    meta_epilogue_match = re.search(r'<!-- META_EPILOGUE_START -->(.*?)<!-- META_EPILOGUE_END -->', content, re.DOTALL)
    if meta_epilogue_match:
        meta_epilogue = extract_paragraphs(meta_epilogue_match.group(1), 'EPILOGUE_PARAGRAPH')
    
    # Extract quest-level lore entries
    quest_lore_dict = {}
    entry_pattern = r'<!-- LORE_ENTRY_START quest_id=(\d+) -->.*?<!-- LORE_ENTRY_END quest_id=\1 -->'
    
    for entry_match in re.finditer(entry_pattern, content, re.DOTALL):
        quest_id = int(entry_match.group(1))
        entry_content = entry_match.group(0)
        
        quest_lore = {}
        
        # Extract prologue section
        prologue_match = re.search(r'<!-- PROLOGUE_START -->(.*?)<!-- PROLOGUE_END -->', entry_content, re.DOTALL)
        if prologue_match:
            quest_lore['prologue'] = extract_paragraphs(prologue_match.group(1), 'PROLOGUE_PARAGRAPH')
        
        # Extract description_lore section
        desc_match = re.search(r'<!-- DESCRIPTION_LORE_START -->(.*?)<!-- DESCRIPTION_LORE_END -->', entry_content, re.DOTALL)
        if desc_match:
            quest_lore['description_lore'] = extract_paragraphs(desc_match.group(1), 'LORE_PARAGRAPH')
        
        # Extract epilogue section
        epilogue_match = re.search(r'<!-- EPILOGUE_START -->(.*?)<!-- EPILOGUE_END -->', entry_content, re.DOTALL)
        if epilogue_match:
            quest_lore['epilogue'] = extract_paragraphs(epilogue_match.group(1), 'EPILOGUE_PARAGRAPH')
        
        if quest_lore:
            quest_lore_dict[quest_id] = quest_lore
        else:
            print(f"WARNING: Quest {quest_id} in {markdown_path.name} has no lore sections", file=sys.stderr)
    
    return (meta_prologue, meta_epilogue, quest_lore_dict)


def extract_paragraphs(section_content: str, paragraph_marker: str) -> List[str]:
    """
    Extract paragraphs from a lore section using paragraph markers.
    
    Args:
        section_content: The content of a lore section
        paragraph_marker: The marker name (e.g., 'LORE_PARAGRAPH', 'PROLOGUE_PARAGRAPH')
        
    Returns:
        List of paragraph strings in order
    """
    paragraphs = []
    paragraph_pattern = rf'<!-- {paragraph_marker} index=(\d+) -->\n(.*?)(?=\n\n<!-- (?:{paragraph_marker}|(?:PROLOGUE|DESCRIPTION_LORE|EPILOGUE|LORE_ENTRY)_(?:START|END))|\n\n---|\Z)'
    
    for para_match in re.finditer(paragraph_pattern, section_content, re.DOTALL):
        index = int(para_match.group(1))
        text = para_match.group(2).strip()
        
        # Ensure we have enough slots in the list
        while len(paragraphs) <= index:
            paragraphs.append(None)
        
        paragraphs[index] = text
    
    # Filter out None values (shouldn't happen with proper markdown)
    paragraphs = [p for p in paragraphs if p is not None]
    
    return paragraphs if paragraphs else []


def update_quest_json(json_path: Path, meta_prologue: Optional[List[str]], meta_epilogue: Optional[List[str]],
                     quest_lore_dict: Dict[int, Dict[str, List[str]]], dry_run: bool = False) -> Tuple[int, int, int]:
    """
    Update a quests.json file with lore entries from markdown.
    
    Args:
        json_path: Path to the quests.json file
        meta_prologue: Meta-level prologue paragraphs or None
        meta_epilogue: Meta-level epilogue paragraphs or None
        quest_lore_dict: Dictionary mapping quest_id to dict with 'prologue', 'description_lore', 'epilogue' keys
        dry_run: If True, show changes without modifying the file
        
    Returns:
        Tuple of (updated_count, added_count, removed_count)
    """
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse JSON in {json_path}: {e}", file=sys.stderr)
        return (0, 0, 0)
    except Exception as e:
        print(f"ERROR: Failed to read {json_path}: {e}", file=sys.stderr)
        return (0, 0, 0)
    
    if 'quests' not in data or not isinstance(data['quests'], list):
        print(f"ERROR: Invalid JSON structure in {json_path}", file=sys.stderr)
        return (0, 0, 0)
    
    updated_count = 0
    added_count = 0
    removed_count = 0
    
    # Update meta-level prologue
    if meta_prologue is not None:
        old_prologue = data.get('prologue', [])
        if old_prologue != meta_prologue:
            if dry_run:
                print(f"  [DRY RUN] Would update meta prologue ({len(old_prologue)} -> {len(meta_prologue)} paragraphs)")
            else:
                data['prologue'] = meta_prologue
            updated_count += 1
    
    # Update meta-level epilogue
    if meta_epilogue is not None:
        old_epilogue = data.get('epilogue', [])
        if old_epilogue != meta_epilogue:
            if dry_run:
                print(f"  [DRY RUN] Would update meta epilogue ({len(old_epilogue)} -> {len(meta_epilogue)} paragraphs)")
            else:
                data['epilogue'] = meta_epilogue
            updated_count += 1
    
    # Create a map of quest_id to quest object for easy lookup
    quest_map = {quest.get('id'): quest for quest in data['quests'] if 'id' in quest}
    
    # Track which quest IDs we've seen in the markdown
    markdown_quest_ids = set(quest_lore_dict.keys())
    json_quest_ids = set(quest_map.keys())
    
    # Update existing quests
    for quest_id, new_lore_sections in quest_lore_dict.items():
        if quest_id in quest_map:
            quest = quest_map[quest_id]
            quest_updated = False
            
            # Update prologue if present in markdown
            if 'prologue' in new_lore_sections:
                old_prologue = quest.get('prologue', [])
                if old_prologue != new_lore_sections['prologue']:
                    if dry_run:
                        print(f"  [DRY RUN] Would update Quest {quest_id} prologue: {quest.get('title', 'Untitled')}")
                        print(f"    Old paragraphs: {len(old_prologue)}, New paragraphs: {len(new_lore_sections['prologue'])}")
                    else:
                        quest['prologue'] = new_lore_sections['prologue']
                    quest_updated = True
            
            # Update description_lore if present in markdown
            if 'description_lore' in new_lore_sections:
                old_lore = quest.get('description_lore', [])
                if old_lore != new_lore_sections['description_lore']:
                    if dry_run:
                        print(f"  [DRY RUN] Would update Quest {quest_id} description_lore: {quest.get('title', 'Untitled')}")
                        print(f"    Old paragraphs: {len(old_lore)}, New paragraphs: {len(new_lore_sections['description_lore'])}")
                    else:
                        quest['description_lore'] = new_lore_sections['description_lore']
                    quest_updated = True
            
            # Update epilogue if present in markdown
            if 'epilogue' in new_lore_sections:
                old_epilogue = quest.get('epilogue', [])
                if old_epilogue != new_lore_sections['epilogue']:
                    if dry_run:
                        print(f"  [DRY RUN] Would update Quest {quest_id} epilogue: {quest.get('title', 'Untitled')}")
                        print(f"    Old paragraphs: {len(old_epilogue)}, New paragraphs: {len(new_lore_sections['epilogue'])}")
                    else:
                        quest['epilogue'] = new_lore_sections['epilogue']
                    quest_updated = True
            
            if quest_updated:
                updated_count += 1
        else:
            # Quest ID in markdown but not in JSON - this is unusual
            if dry_run:
                print(f"  [DRY RUN] Would add new Quest {quest_id} (found in markdown but not in JSON)")
            added_count += 1
    
    # Check for quests removed from markdown
    for quest_id in json_quest_ids:
        if quest_id not in markdown_quest_ids:
            quest = quest_map[quest_id]
            has_lore = any(field in quest for field in ['prologue', 'description_lore', 'epilogue'])
            if has_lore:
                if dry_run:
                    print(f"  [DRY RUN] Quest {quest_id} has lore in JSON but not in markdown (would keep existing)")
                removed_count += 1
    
    # Write updated JSON back to file
    if not dry_run and updated_count > 0:
        try:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write('\n')  # Add trailing newline
        except Exception as e:
            print(f"ERROR: Failed to write {json_path}: {e}", file=sys.stderr)
            return (0, 0, 0)
    
    return (updated_count, added_count, removed_count)


def main():
    """
    Main function to process all lore markdown files.
    """
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Update quest JSON files from lore markdown files'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without modifying files'
    )
    args = parser.parse_args()
    
    # Define the base directory for quests
    project_root = Path(__file__).parent.parent.parent
    quests_base_dir = project_root / 'frontend' / 'quests'
    
    # Check if the quests directory exists
    if not quests_base_dir.exists():
        print(f"ERROR: Quests directory not found: {quests_base_dir}", file=sys.stderr)
        sys.exit(1)
    
    # Find all lore-{genre}.md files
    lore_files = list(quests_base_dir.glob('*/lore-*.md'))
    
    if not lore_files:
        print(f"WARNING: No lore markdown files found in {quests_base_dir}", file=sys.stderr)
        sys.exit(0)
    
    print(f"Found {len(lore_files)} lore file(s) to process")
    if args.dry_run:
        print("DRY RUN MODE - No files will be modified\n")
    print()
    
    # Process each lore file
    total_updated = 0
    total_added = 0
    total_removed = 0
    
    for lore_file in sorted(lore_files):
        # Extract genre from filename (lore-{genre}.md)
        genre = lore_file.stem.replace('lore-', '')
        
        print(f"Processing {genre}...")
        
        # Parse the markdown file
        meta_prologue, meta_epilogue, quest_lore_dict = parse_lore_markdown(lore_file)
        
        if not quest_lore_dict and not meta_prologue and not meta_epilogue:
            print(f"⚠ No lore entries found in {lore_file.name}\n")
            continue
        
        if quest_lore_dict:
            print(f"  Parsed {len(quest_lore_dict)} quest lore entries from markdown")
        if meta_prologue:
            print(f"  Parsed meta prologue with {len(meta_prologue)} paragraph(s)")
        if meta_epilogue:
            print(f"  Parsed meta epilogue with {len(meta_epilogue)} paragraph(s)")
        
        # Find corresponding quests.json file
        json_file = lore_file.parent / 'quests.json'
        
        if not json_file.exists():
            print(f"✗ quests.json not found at {json_file}\n")
            continue
        
        # Update the JSON file
        updated, added, removed = update_quest_json(json_file, meta_prologue, meta_epilogue, quest_lore_dict, args.dry_run)
        
        total_updated += updated
        total_added += added
        total_removed += removed
        
        if args.dry_run:
            if updated > 0 or added > 0 or removed > 0:
                print(f"  Would update: {updated}, add: {added}, remove: {removed}")
        else:
            if updated > 0:
                print(f"✓ Updated {updated} quest(s) in {json_file.name}")
            else:
                print(f"  No changes needed")
        
        print()
    
    # Summary
    if args.dry_run:
        print(f"DRY RUN SUMMARY:")
        print(f"  Would update: {total_updated} quest(s)")
        print(f"  Would add: {total_added} quest(s)")
        print(f"  Quests with lore in JSON but not markdown: {total_removed}")
    else:
        print(f"✓ Complete! Updated {total_updated} quest(s) across all genres.")
        if total_added > 0:
            print(f"  Note: {total_added} quest(s) found in markdown but not in JSON")
        if total_removed > 0:
            print(f"  Note: {total_removed} quest(s) have lore in JSON but not in markdown (kept existing)")


if __name__ == '__main__':
    main()