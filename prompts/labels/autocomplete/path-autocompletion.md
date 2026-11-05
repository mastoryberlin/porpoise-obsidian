# Vault Path Autocompletion
One of the core features of this plugin: autocompletion of `@`-mentions to vault files so they can be conveniently referenced in prompts. Here's how it works:
- When a user types @ inside a note *preceded by whitespace*, display a popup menu just like e.g. the tags autocomplete list, offering relative paths available from the vault root folder
- If the user selects a folder, append a `/` to it then display another popup offerings the subfolders. Suggestions always only go "one level deep" per popup menu
- In addition to files+folders present at the "current" FS position, offer `..` everywhere to access the parent folder (hidden at folder root)
- on click, or on key press of either TAB, ENTER, or (for folders) `/`, the path at the current cursor position is autocompleted accordingly. In the last (slash) case, we gulp the trailing slash to prevent duplicates
- the files + folders offered for autocompletion are *not restricted* by any means except for the "one level" rule - non-Markdown or hidden files, dot-prefixed folders ... everything is included in the list!