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
Extract lore entries from quest JSON files and save them to genre-specific markdown files.

This script:
1. Finds all quests.json files in frontend/quests/*/
2. Parses each JSON file
3. Extracts the "prologue", "description_lore", and "epilogue" fields from the meta and quest sections
4. Properly unescapes the lore text (handling \n, \", etc.)
5. Formats output as markdown with quest headers and clear section markers
6. Appends lore entries to lore-{genre}.md files
"""

import json
import sys
from pathlib import Path


def unescape_lore(lore_array):
    """
    Properly unescape JSON string content from lore array.
    
    Python's json.loads() already handles most escape sequences,
    so we just need to return the text as-is.
    
    Args:
        lore_array: The lore array from JSON (list of strings)
        
    Returns:
        List of properly unescaped strings with actual newlines, quotes, etc.
    """
    # The json module already handles unescaping when parsing,
    # so we just need to return the array as-is
    return lore_array


def extract_lore_from_file(quest_file_path):
    """
    Extract all lore entries with metadata from a single quests.json file.
    
    Args:
        quest_file_path: Path object pointing to a quests.json file
        
    Returns:
        Tuple of (prologue, epilogue, quest_lore_entries), or None if parsing fails
        - prologue: List of strings or None
        - epilogue: List of strings or None
        - quest_lore_entries: List of tuples (quest_id, quest_title, prologue, description_lore, epilogue)
    """
    try:
        with open(quest_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract top-level prologue and epilogue
        meta_prologue = unescape_lore(data.get('prologue', [])) if 'prologue' in data else None
        meta_epilogue = unescape_lore(data.get('epilogue', [])) if 'epilogue' in data else None
        
        # Extract lore entries with metadata from the quests array
        quest_lore_entries = []
        if 'quests' in data and isinstance(data['quests'], list):
            for quest in data['quests']:
                # Only include quests that have at least one lore field
                has_lore = any(field in quest for field in ['prologue', 'description_lore', 'epilogue'])
                
                if has_lore:
                    # Extract quest metadata
                    quest_id = quest.get('id', 'Unknown')
                    quest_title = quest.get('title', 'Untitled Quest')
                    
                    # Unescape the lore text for each field
                    prologue = unescape_lore(quest['prologue']) if 'prologue' in quest else None
                    description_lore = unescape_lore(quest['description_lore']) if 'description_lore' in quest else None
                    epilogue = unescape_lore(quest['epilogue']) if 'epilogue' in quest else None
                    
                    # Store as tuple with metadata
                    quest_lore_entries.append((quest_id, quest_title, prologue, description_lore, epilogue))
        
        return (meta_prologue, meta_epilogue, quest_lore_entries)
    
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse JSON in {quest_file_path}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR: Failed to read {quest_file_path}: {e}", file=sys.stderr)
        return None


def write_lore_to_file(output_file_path, meta_prologue, meta_epilogue, quest_lore_entries):
    """
    Append lore entries with structured markdown headers to the output file.
    
    The format uses clear delimiters and identifiers to allow precise
    modification of specific entries by other scripts.
    
    Args:
        output_file_path: Path object for the output file
        meta_prologue: List of prologue paragraphs or None
        meta_epilogue: List of epilogue paragraphs or None
        quest_lore_entries: List of tuples (quest_id, quest_title, prologue, description_lore, epilogue)
    """
    try:
        # Open in append mode to preserve existing content
        with open(output_file_path, 'a', encoding='utf-8') as f:
            # Write meta-level prologue if present
            if meta_prologue:
                f.write("<!-- META_PROLOGUE_START -->\n")
                f.write("# Prologue\n\n")
                for idx, paragraph in enumerate(meta_prologue):
                    f.write(f"<!-- PROLOGUE_PARAGRAPH index={idx} -->\n")
                    f.write(paragraph)
                    f.write('\n\n')
                f.write("<!-- META_PROLOGUE_END -->\n\n")
                f.write('---\n\n')
            
            # Write quest lore entries
            for quest_id, quest_title, prologue, description_lore, epilogue in quest_lore_entries:
                # Write structured header with clear identifiers
                f.write(f"<!-- LORE_ENTRY_START quest_id={quest_id} -->\n")
                f.write(f"## Quest {quest_id}: {quest_title}\n\n")
                
                # Write prologue if present
                if prologue:
                    f.write("<!-- PROLOGUE_START -->\n")
                    f.write("### Prologue\n\n")
                    for idx, paragraph in enumerate(prologue):
                        f.write(f"<!-- PROLOGUE_PARAGRAPH index={idx} -->\n")
                        f.write(paragraph)
                        f.write('\n\n')
                    f.write("<!-- PROLOGUE_END -->\n\n")
                
                # Write description_lore if present
                if description_lore:
                    f.write("<!-- DESCRIPTION_LORE_START -->\n")
                    f.write("### Description Lore\n\n")
                    for idx, paragraph in enumerate(description_lore):
                        f.write(f"<!-- LORE_PARAGRAPH index={idx} -->\n")
                        f.write(paragraph)
                        f.write('\n\n')
                    f.write("<!-- DESCRIPTION_LORE_END -->\n\n")
                
                # Write epilogue if present
                if epilogue:
                    f.write("<!-- EPILOGUE_START -->\n")
                    f.write("### Epilogue\n\n")
                    for idx, paragraph in enumerate(epilogue):
                        f.write(f"<!-- EPILOGUE_PARAGRAPH index={idx} -->\n")
                        f.write(paragraph)
                        f.write('\n\n')
                    f.write("<!-- EPILOGUE_END -->\n\n")
                
                # Add end marker for this quest's lore entry
                f.write(f"<!-- LORE_ENTRY_END quest_id={quest_id} -->\n\n")
                f.write('---\n\n')
            
            # Write meta-level epilogue if present
            if meta_epilogue:
                f.write("<!-- META_EPILOGUE_START -->\n")
                f.write("# Epilogue\n\n")
                for idx, paragraph in enumerate(meta_epilogue):
                    f.write(f"<!-- EPILOGUE_PARAGRAPH index={idx} -->\n")
                    f.write(paragraph)
                    f.write('\n\n')
                f.write("<!-- META_EPILOGUE_END -->\n\n")
        
        print(f"✓ Wrote {len(quest_lore_entries)} quest lore entries to {output_file_path}")
        if meta_prologue:
            print(f"  + Meta prologue with {len(meta_prologue)} paragraph(s)")
        if meta_epilogue:
            print(f"  + Meta epilogue with {len(meta_epilogue)} paragraph(s)")
    
    except Exception as e:
        print(f"ERROR: Failed to write to {output_file_path}: {e}", file=sys.stderr)


def main():
    """
    Main function to process all quest files.
    """
    # Define the base directory for quests
    project_root = Path(__file__).parent.parent.parent
    quests_base_dir = project_root / 'frontend' / 'quests'
    
    # Check if the quests directory exists
    if not quests_base_dir.exists():
        print(f"ERROR: Quests directory not found: {quests_base_dir}", file=sys.stderr)
        sys.exit(1)
    
    # Find all quests.json files in genre subdirectories
    quest_files = list(quests_base_dir.glob('*/quests.json'))
    
    if not quest_files:
        print(f"WARNING: No quests.json files found in {quests_base_dir}", file=sys.stderr)
        sys.exit(0)
    
    print(f"Found {len(quest_files)} quest file(s) to process\n")
    
    # Process each quest file
    total_lore_entries = 0
    for quest_file in sorted(quest_files):
        # Extract genre from directory name
        genre = quest_file.parent.name
        
        print(f"Processing {genre}...")
        
        # Extract lore entries from the JSON file
        result = extract_lore_from_file(quest_file)
        
        if result is None:
            print(f"✗ Skipping {genre} due to errors\n")
            continue
        
        meta_prologue, meta_epilogue, quest_lore_entries = result
        
        if not quest_lore_entries and not meta_prologue and not meta_epilogue:
            print(f"⚠ No lore entries found in {quest_file}\n")
            continue
        
        # Define output file path
        output_file = quest_file.parent / f'lore-{genre}.md'
        
        # Write lore entries to file
        write_lore_to_file(output_file, meta_prologue, meta_epilogue, quest_lore_entries)
        total_lore_entries += len(quest_lore_entries)
        print()
    
    print(f"✓ Complete! Extracted {total_lore_entries} total quest lore entries.")


if __name__ == '__main__':
    main()