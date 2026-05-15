"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import type { CMOContextQuality, VaultNoteRef } from "@/lib/cmo/app-workspace-types";
import { cn } from "@/lib/utils";

function qualityVariant(quality: CMOContextQuality | undefined, exists: boolean | undefined): "green" | "orange" | "slate" | "blue" {
  if (exists === false || quality === "missing") {
    return "slate";
  }

  if (quality === "confirmed") {
    return "green";
  }

  if (quality === "draft") {
    return "blue";
  }

  return "orange";
}

function qualityLabel(quality: CMOContextQuality | undefined, exists: boolean | undefined): string {
  if (exists === false || quality === "missing") {
    return "missing";
  }

  if (quality === "placeholder") {
    return "Needs content";
  }

  return quality ?? "draft";
}

export function ContextSelector({
  notes,
  onChange,
  compactByDefault = false,
}: {
  notes: VaultNoteRef[];
  onChange: (notes: VaultNoteRef[]) => void;
  compactByDefault?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(!compactByDefault);

  function toggleNote(noteId: string) {
    onChange(notes.map((note) => (note.id === noteId ? { ...note, selected: !note.selected } : note)));
  }

  const selectedCount = notes.filter((note) => note.selected).length;
  const selectedNotes = notes.filter((note) => note.selected);
  const existingCount = selectedNotes.filter((note) => note.exists !== false && note.contextQuality !== "missing").length;
  const missingCount = selectedNotes.filter((note) => note.exists === false || note.contextQuality === "missing").length;
  const confirmedCount = selectedNotes.filter((note) => note.contextQuality === "confirmed").length;
  const placeholderCount = selectedNotes.filter((note) => note.contextQuality === "placeholder").length;
  const draftCount = selectedNotes.filter((note) => note.contextQuality === "draft").length;
  const mostNotesArePlaceholders = selectedCount > 0 && placeholderCount > selectedCount / 2;
  const qualitySummary =
    selectedCount === 0
      ? "No context notes selected"
      : mostNotesArePlaceholders
        ? "Most selected notes need content"
        : draftCount > 0 || placeholderCount > 0
          ? "Some selected notes are draft or need content"
          : "Selected notes look confirmed";
  const selectedPreview = selectedNotes.slice(0, 4).map((note) => note.title).join(", ");
  const selectedSummary = selectedCount > 4 ? `${selectedPreview}, +${selectedCount - 4} more` : selectedPreview;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <icons.Database />
          </div>
          <div>
            <CardTitle>Selected Context</CardTitle>
            <CardDescription>{selectedCount ? selectedSummary : "Choose context notes for the next CMO exchange."}</CardDescription>
          </div>
        </div>
        <Badge variant={selectedCount ? "green" : "orange"}>{selectedCount} selected</Badge>
      </div>

      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={missingCount ? "orange" : "green"}>
            {existingCount} / {selectedCount} context files found
          </Badge>
          <Badge variant={confirmedCount ? "green" : "slate"}>{confirmedCount} confirmed</Badge>
          <Badge variant={draftCount ? "blue" : "slate"}>{draftCount} draft</Badge>
          <Badge variant={placeholderCount ? "orange" : "slate"}>{placeholderCount} need content</Badge>
          {missingCount ? <Badge variant="red">{missingCount} missing</Badge> : null}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-700">{qualitySummary}</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">
          {mostNotesArePlaceholders
            ? "Context files exist, but most still need content. CMO output may rely on assumptions until app memory is filled."
            : "CMO will use selected context notes, but recommendations may be generic until app memory is filled."}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? <icons.ChevronUp /> : <icons.ChevronDown />}
          {isExpanded ? "Hide context files" : "Review context files"}
        </Button>
      </div>

      {isExpanded ? <div className="mt-5 space-y-3">
        {notes.map((note) => (
          <label
            key={note.id}
            className={cn(
              "flex cursor-pointer gap-3 rounded-xl border px-3 py-3 transition",
              note.selected ? "border-indigo-200 bg-indigo-50/70" : "border-slate-100 bg-slate-50 hover:border-slate-200",
            )}
          >
            <input
              type="checkbox"
              checked={Boolean(note.selected)}
              onChange={() => toggleNote(note.id)}
              className="mt-1 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-950">{note.title}</span>
                <Badge variant={note.exists === false ? "slate" : "green"}>{note.exists === false ? "File missing" : "File exists"}</Badge>
                <Badge variant={qualityVariant(note.contextQuality, note.exists)}>{qualityLabel(note.contextQuality, note.exists)}</Badge>
                {note.frontmatterStatus ? <Badge variant="slate">status: {note.frontmatterStatus}</Badge> : null}
                <Badge variant={note.type === "daily-note" ? "blue" : "default"}>{note.type}</Badge>
              </span>
              <span className="mt-1 block break-all text-xs font-medium text-slate-500">{note.path}</span>
              {note.qualityReason ? <span className="mt-1 block text-xs text-slate-500">{note.qualityReason}</span> : null}
              {note.reason ? <span className="mt-1 block text-xs text-slate-400">{note.reason}</span> : null}
            </span>
          </label>
        ))}
      </div> : null}
    </Card>
  );
}
