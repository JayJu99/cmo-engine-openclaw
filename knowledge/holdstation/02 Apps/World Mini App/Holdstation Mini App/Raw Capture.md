---
title: Holdstation Mini App - Raw Capture Index
type: raw-capture-index
status: draft
scope: holdstation
vault: holdstation
app: Holdstation Mini App
app_id: holdstation-mini-app
source_id: holdstation__holdstation-mini-app
logical_app_path: Apps/Holdstation Mini App
physical_app_vault_path: 02 Apps/World Mini App/Holdstation Mini App
tags:
  - holdstation
  - app
  - raw-capture
---

# Holdstation Mini App - Raw Capture Index

## Purpose

This file is an app-local index for raw capture sources. It is not full raw capture context and should not be injected wholesale into CMO turns.

## Current Sources

- [[06 Journal/Raw/2026-05-14.md]] - global raw capture log containing Holdstation Mini App Phase 1 verification and smoke-test entries.
- [[06 Journal/Daily/2026-05-14.md]] - deterministic daily note generated from raw captures.

## Context Policy

- Full raw capture text is excluded from the default context pack.
- Raw capture entries can produce promotion candidates after review.
- Raw capture text should not become durable App Memory without human review.

## Known Limits

- No live runtime metrics are present in raw captures.
- No Task Tracker data is present in raw captures.
- Several entries are implementation smoke tests, not market or product evidence.

