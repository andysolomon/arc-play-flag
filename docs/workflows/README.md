# Workflows

Plans tracked as [arc-pi-gantt-workflow](https://github.com/andysolomon/arc-pi-gantt-workflow) sources.

- The source of truth for a plan is `.arc/workflows/<slug>/workflow.yaml`: groups are the tracker's sections, leaves are its issues, and a leaf's `dependencies` are the tracker's stated sequencing.
- `docs/workflows/<slug>/progress.txt` and `gantt.mmd` are generated projections. Edit the YAML, never these files; their headers carry fingerprints so the tool can detect a hand edit.
- A leaf is `ready` only when it names an outcome, a bounded scope, acceptance criteria, at least one dependency, and the behaviour it must preserve, and every dependency is `completed`. Readiness is never inferred from a checkbox.

## Regenerate

```sh
git clone https://github.com/andysolomon/arc-pi-gantt-workflow ../arc-pi-gantt-workflow
(cd ../arc-pi-gantt-workflow && npm install --ignore-scripts)
node scripts/render-workflow.mjs ../arc-pi-gantt-workflow production-readiness
```

Pass a date as the third argument to keep a render byte-stable. Node 22.19 or newer is required.

## Update a checkpoint

When an issue closes, set its leaf's `checkpoint.state` to `completed`, bump `updated_at`, add the merged PR as `evidence_ref`, and regenerate. Leaves whose dependencies are now all completed can move from `planned` to `ready`.

## Plans

| Slug | Tracks |
| --- | --- |
| `production-readiness` | The 2026-09-08 review's tracker, issue #41 |
