# Task Graph
Located in @src/features/task-graph/, this feature is a fork of the [Spatial Task Graph](https://github.com/cccjhuan/spatial-task-graph) plugin, adjusted to work on Porpoise's section-style tasks.
I.e. instead of gathering standard Markdown tasks (`- [ ]` / `- [x]`) from vault notes, it looks for top-level headings (H1 / `# ...`) and allows editing their body directly from graph nodes.

This feature is a WIP; implementation status/roadmap below:
- [x] task collection and basic sync
- [x] task title/section heading editing from graph nodes
- [x] task/section body editing from graph nodes
- [x] path-based filters
- [x] dependency connections between tasks
	- [x] add dependencies
	- [x] create new tasks from the "+" option when dragging a connector onto empty canvas space
- [x] display tasks from `_done.md` as "Finished"
- [x] status-based filters
- [x] mouse handling for pan+zoom: right/middle drag pans, wheel zooms, Ctrl+wheel scrolls, middle-click fits the view