---
name: search-history
description: Search locally stored Claude Code and Codex conversations, identify relevant sessions from vague memories or keywords, and load selected conversations for deliberate recall. Use when the user asks what was discussed before, wants to find a past design decision, or wants to resume earlier work without knowing the session ID.
---

# Search History

Search all locally stored Claude Code and Codex sessions, then load only the
conversation needed for the current task.

## Search

Extract two to five distinctive keywords from the request. Prefer technical
terms, proper nouns, and uncommon phrases over generic words. Quote keywords
that contain spaces.

```sh
"$HOME/.local/bin/kura" search <keyword...>
```

- Read the JSON result as
  `{ query, count, hits:[{ session, short, cwd, span, matched, hits, size, snippets }] }`.
- Prefer hits matching more distinct keywords, then use `span`, `cwd`, and
  `snippets` to identify the intended work.
- Treat `size` as the cost estimate for loading the full conversation.
- Refine the keywords when results are broad. Use `--limit=N` when necessary.

## Select

Load the matching sessions immediately when there are at most three strong
candidates and their combined `size` is at most 100,000 characters. State which
sessions were loaded by `short`, `cwd`, and `span`.

When candidates are numerous, large, or ambiguous, present a short selection
using `cwd`, `span`, and representative `snippets`, then ask the user which one
to load.

## Load

Load one session at a time using its full ID or a unique prefix:

```sh
"$HOME/.local/bin/kura" show <session>
```

Use the returned JSON conversation as context for the current request. If the
session ID is already known, skip search and run `show` directly.

## Boundaries

- Keep this skill read-only.
- Do not modify the history database; only configured history hooks write to it.
- Do not summarize or rewrite stored history unless the user's current request
  asks for that work.
