# autocomplete @ path refs!
This plugin is currently a sample; you're building the first piece of actual functionality:
- When a user types @ inside a note *preceded by whitespace*, display a popup menu just like e.g. the tags autocomplete list, offering relative paths available from the vault root folder
- If the user selects a folder, append a `/` to it then display another popup offerings the subfolders. Bottom line is, suggestions should always only go "one level deep" per popup menu
- In addition to files+folders present at the "current" FS position, offer `..` everywhere to access the parent folder. (Do not offer a `.` though as that would be redundant!)
- I don't know about any FS protection enforced by Obsidian upon plugins. If possible, offer files/folders outside the vault. If that's disallowed, just hide the `..` option at folder root.
- Select a menu item on click, or on key press of either TAB, ENTER, or (for folders) `/`. (In the last (slash) case, make sure to gulp the trailing slash to prevent duplicates.)
- *DO NOT* limit the files + folders offered by any means except for the "one level" rule - non-Markdown or hidden files, dot-prefixed folders ... everything should be included in the list!

# display tasks from `_done.md` as "Finished" [#4](https://github.com/mastoryberlin/porpoise-obsidian/issues/4)
Implement this feature still missing from the Task Graph feature: path-based filtering works nicely, but the status-based filters don't work (didn't so in the original plugin either!). Determine a task's status according to the following algorithm:
- does task title end with a link to a GitHub issue?
	- yes -> check issue status on GH using Octokit! Is the issue closed?
		- yes ->set task status to "Finished"
		- no ->does it have an incoming connector marking it as dependent on another task in the graph,  *OR*  does it have unresolved "blocked by" dependencies set on GH?
			- yes ->set task status to "Blocked"
			- no ->set task status to "In progress"
	- no ->set task status to "Pending"