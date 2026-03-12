---
phase: 16-reaction-animations
plan: "01"
subsystem: frontend-reactions
tags: [reactions, animations, ui, emoji]
dependency_graph:
  requires: []
  provides: [12-emoji-grid-picker, per-emoji-animations]
  affects: [ReactionButtons, ReactionsOverlay, useReactions]
tech_stack:
  added: []
  patterns: [inline-styles-only, jsx-style-tag-keyframes, emoji-animation-map]
key_files:
  created: []
  modified:
    - frontend/src/components/ReactionButtons.tsx
    - frontend/src/components/ReactionsOverlay.tsx
decisions:
  - "12-emoji grid uses 4 columns (repeat(4, 1fr)) for 3x4 layout matching spec"
  - "All @keyframes remain in JSX style tag per Phase 10 convention — no external CSS"
  - "EMOJI_ANIMATIONS map with DEFAULT_ANIMATION fallback for unknown emoji types"
  - "reaction-angry uses 1.8s duration; reaction-lightning 1.5s; reaction-hundred and reaction-rocket use 2.0s for distinct timing feel"
metrics:
  duration: 67s
  completed: "2026-03-12"
  tasks_completed: 2
  files_modified: 2
requirements: [REACT-01, REACT-02, REACT-03]
---

# Phase 16 Plan 01: Reaction Animations Summary

**One-liner:** 12-emoji grid picker with per-emoji-type distinct @keyframes animations mapped via EMOJI_ANIMATIONS lookup.

## What Was Built

Upgraded both reaction components from a 6-emoji flex-row with a single generic animation to a 12-emoji CSS grid with visually distinct per-type animations.

**ReactionButtons.tsx** — Expanded from 6 to 12 emojis (`❤️ 😂 👍 👎 😮 😢 😡 🎉 🔥 ⚡ 💯 🚀`) and changed layout from `display: flex` row to `display: grid` with `gridTemplateColumns: 'repeat(4, 1fr)'` (4 columns, 3 rows). Button fontSize reduced to `1.25rem` for compact grid fit. All other style patterns (disabled/opacity behavior, no border, pointer cursor) unchanged.

**ReactionsOverlay.tsx** — Added 12 distinct @keyframes blocks inside the existing JSX `<style>` tag: heart (scale pulse), laugh (side-to-side wobble rise), thumbsup (arc right), thumbsdown (arc left + sink), wow (zoom burst), cry (drop then rise), angry (rapid shake), party (rotate 360 while rising), fire (flicker scale), lightning (opacity flash), hundred (double spin + scale out), rocket (steep diagonal launch). Added `EMOJI_ANIMATIONS` Record map and `DEFAULT_ANIMATION` fallback. Replaced hardcoded animation string with `EMOJI_ANIMATIONS[reaction.emoji] ?? DEFAULT_ANIMATION` lookup.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Upgrade ReactionButtons to 12-emoji picker grid | 7ec04e1 | ReactionButtons.tsx |
| 2 | Add 12 distinct per-emoji-type animations to ReactionsOverlay | 52f9b2c | ReactionsOverlay.tsx |

## Verification Results

- `npx tsc --noEmit` — PASSED (0 errors)
- `npx vitest run` — PASSED (127 tests, 8 test files)
- `grep -c "@keyframes" ReactionsOverlay.tsx` — 14 (13 named + 1 default fallback)
- `grep "gridTemplateColumns" ReactionButtons.tsx` — FOUND (`repeat(4, 1fr)`)

## Decisions Made

1. **4-column grid:** `gridTemplateColumns: 'repeat(4, 1fr)'` gives a clean 4x3 layout for 12 emojis as specified.
2. **JSX style tag preserved:** All @keyframes remain in the inline `<style>` tag per Phase 10 decision — no external CSS files created.
3. **EMOJI_ANIMATIONS map placement:** Defined at module level (outside component) to avoid recreation on each render.
4. **Variable animation durations:** angry (1.8s), lightning (1.5s), hundred/rocket (2.0s) — distinct timing reinforces visual uniqueness across types.
5. **DEFAULT_ANIMATION fallback:** `reaction-fade-up` kept as fallback for any unknown emoji type passed from external sources.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `frontend/src/components/ReactionButtons.tsx` — EXISTS
- [x] `frontend/src/components/ReactionsOverlay.tsx` — EXISTS
- [x] Commit 7ec04e1 — EXISTS
- [x] Commit 52f9b2c — EXISTS
- [x] 14 @keyframes blocks in ReactionsOverlay (>= 12 required)
- [x] gridTemplateColumns in ReactionButtons confirmed
- [x] 127 vitest tests passing

## Self-Check: PASSED
