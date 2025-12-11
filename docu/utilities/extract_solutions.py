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
Extract solutions from quest JSON files and save them to genre-specific markdown files.

This script:
1. Finds all quests.json files in frontend/quests/*/
2. Parses each JSON file
3. Extracts the "solution" field along with quest metadata (id, title) from every quest
4. Properly unescapes the solution text (handling \n, \", etc.)
5. Formats output as markdown with quest headers
6. Appends solutions to solution-{genre}.md files
"""

import json
import sys
from pathlib import Path


def unescape_solution(solution_text):
    """
    Properly unescape JSON string content.
    
    Python's json.loads() already handles most escape sequences,
    but we ensure the text is properly decoded.
    
    Args:
        solution_text: The solution string from JSON
        
    Returns:
        Properly unescaped string with actual newlines, quotes, etc.
    """
    # The json module already handles unescaping when parsing,
    # so we just need to return the text as-is
    return solution_text


def extract_solutions_from_file(quest_file_path):
    """
    Extract all solutions with metadata from a single quests.json file.
    
    Args:
        quest_file_path: Path object pointing to a quests.json file
        
    Returns:
        List of tuples (quest_id, quest_title, solution), or None if parsing fails
    """
    try:
        with open(quest_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract solutions with metadata from the quests array
        solutions = []
        if 'quests' in data and isinstance(data['quests'], list):
            for quest in data['quests']:
                if 'solution' in quest:
                    # Extract quest metadata
                    quest_id = quest.get('id', 'Unknown')
                    quest_title = quest.get('title', 'Untitled Quest')
                    
                    # Unescape the solution text
                    solution = unescape_solution(quest['solution'])
                    
                    # Store as tuple with metadata
                    solutions.append((quest_id, quest_title, solution))
        
        return solutions
    
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse JSON in {quest_file_path}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR: Failed to read {quest_file_path}: {e}", file=sys.stderr)
        return None


def write_solutions_to_file(output_file_path, solutions):
    """
    Append solutions with markdown headers to the output file.
    
    Args:
        output_file_path: Path object for the output file
        solutions: List of tuples (quest_id, quest_title, solution) to write
    """
    try:
        # Open in append mode to preserve existing content
        with open(output_file_path, 'a', encoding='utf-8') as f:
            for i, (quest_id, quest_title, solution) in enumerate(solutions):
                # Write markdown header with quest metadata
                f.write(f"## Quest: {quest_title} (ID: {quest_id})\n\n")
                
                # Write the solution wrapped in markdown code block
                f.write("```rego\n")
                f.write(solution)
                f.write("\n```")
                
                # Add separator after each solution
                f.write('\n\n---\n\n')
        
        print(f"✓ Wrote {len(solutions)} solutions to {output_file_path}")
    
    except Exception as e:
        print(f"ERROR: Failed to write to {output_file_path}: {e}", file=sys.stderr)


def main():
    """
    Main function to process all quest files.
    """
    # Define the base directory for quests
    project_root = Path(__file__).parent
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
    total_solutions = 0
    for quest_file in sorted(quest_files):
        # Extract genre from directory name
        genre = quest_file.parent.name
        
        print(f"Processing {genre}...")
        
        # Extract solutions from the JSON file
        solutions = extract_solutions_from_file(quest_file)
        
        if solutions is None:
            print(f"✗ Skipping {genre} due to errors\n")
            continue
        
        if not solutions:
            print(f"⚠ No solutions found in {quest_file}\n")
            continue
        
        # Define output file path
        output_file = quest_file.parent / f'solution-{genre}.md'
        
        # Write solutions to file
        write_solutions_to_file(output_file, solutions)
        total_solutions += len(solutions)
        print()
    
    print(f"✓ Complete! Extracted {total_solutions} total solutions.")


if __name__ == '__main__':
    main()