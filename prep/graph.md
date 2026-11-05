#graph

---
# status-based filters [#3](https://github.com/mastoryberlin/porpoise-obsidian/issues/3)
Implement this feature still missing from the Task Graph feature: path-based filtering works nicely, but the status-based filters don't work (didn't so in the original plugin either!). Determine a task's status according to the following algorithm:
- does task title end with a link to a GitHub issue?
	- yes -> check issue status on GH using Octokit! Is the issue closed?
		- yes ->set task status to "Finished"
		- no ->does it have an incoming connector marking it as dependent on another task in the graph,  *OR*  does it have unresolved "blocked by" dependencies set on GH?
			- yes ->set task status to "Blocked"
			- no ->set task status to "In progress"
	- no ->set task status to "Pending"
# display tasks from `_done.md` as "Finished" [#4](https://github.com/mastoryberlin/porpoise-obsidian/issues/4)
Implement this feature still missing from the Task Graph feature. Plain and simply this. Touch nothing else.
