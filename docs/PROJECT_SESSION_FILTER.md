# Project filter for the session list — ONE spec for all clients

Single cross-client description. Desktop (Electron/JS), Android (Kotlin), iOS
(Swift) implement this identically. It is a **faithful port** of the
dream-tracker web "tag-lens" project filter — do not invent a parallel design.

## Canonical source (dream-tracker web — reuse, don't reinvent)
- Descendant scope: `dream-tracker/src/queries/tagGraph.ts` → `collectDescendantTagIds(rootTagId, tagParents)`
  — DAG walk over `tag_parents` edges, global-dedup, iterative, cycle-safe.
- Collapsible project-tree UI + click-to-scope: `TagNavigator` / `TagTreeNodeRow`
  (`node.isOpen` collapse/expand chevron; clicking a project row scopes the view
  via `activeTagLensId`).
- Documented shared node: `dream-tracker/docs/ECOSYSTEM_MAP.md` id=`tag-graph`.

The chat-aggregator clients already fetch the raw DAG (`tags` + `tag_parents`,
e.g. desktop `main.js` `dream-list-project-tree-data`) and already have a local
collapsible project tree (desktop `renderProjectTreeNode`+`expandedProjectNodeIds`,
Android/iOS equivalents). Reuse those; the shared **kernel** (`collectDescendantTagIds`)
is ported 1:1, the per-client tree **UI mapping stays local**.

## Behaviour
0. COMPACT trigger: the filter is a SMALL ICON BUTTON (funnel) in the session
   list's action row (next to refresh), not an always-visible bar/dropdown.
   Tapping it opens a popover/sheet containing: a "Filter projects…" search
   field + the collapsible project tree below. The icon shows an active state
   (tint/highlight) when a filter other than "All" is applied. Selecting a row
   closes the popover. (Desktop reference implementation: renderer.js
   `sessions-project-filter-btn` / `-pop`.)
1. The session list's project filter IS the existing collapsible project tree
   (same rows/chevrons as the project panel), NOT a flat dropdown/`<select>`.
   The project search field filters that list: non-empty query → flat list of
   name-matching projects (depth-indented); empty → the collapsible tree.
2. **Default: everything collapsed** (compact). Use a filter-local expand state,
   independent of the project-panel's expand state.
3. Rows: `All projects` (default, no scope) + `No project` (sessions whose
   `projectTagId` is null/blank) + the project tree.
4. Single-select scope. Clicking a project row filters the session list to that
   project **and all its descendants**, computed by the ported
   `collectDescendantTagIds` over `tag_parents` (NOT a `children`-tree walk).
5. Combined with the existing text search by AND.
6. A stale selected id (project deleted from the tree) falls back to `All`.

## Kernel port (pseudocode — identical semantics per language)
```
collectDescendantTagIds(rootId, tagParents):
  childrenByParent = index of parentId -> [tagId] from tagParents edges
  ids = {rootId}; stack = [rootId]
  while stack:
    cur = stack.pop()
    for child in childrenByParent[cur]:
      if child in ids: continue
      ids.add(child); stack.push(child)
  return ids
```

## Non-goals
- No new `p_project_tag_id` on the save RPC (unverified; the backend already
  derives a session's project via its linked note). Local `projectTagId` stamp
  at save time only, for immediate/offline filtering.
