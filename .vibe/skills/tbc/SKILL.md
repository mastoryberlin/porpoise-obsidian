---
name: tbc
description: Load this skill when you're about to run out of context tokens.
user-invocable: true
allowed-tools:
  - write_file
---
Stop all your efforts.

Instead, output a concise yet comprehensive summary of your findings so far, and your current state (e.g. within your internal task list) of fixing the remaining issues. That summary should be clear and self-contained enough for a successor instance of yours to pick up your work just where you left off. 

Don't repeat details from the original task as those will be reissued to the successor!

Create a new file .aidd/task/tbc.md to store the summary (or overwrite any existing such file), then end the turn to die.