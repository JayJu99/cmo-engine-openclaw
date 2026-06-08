function isBackendContextLine(line: string): boolean {
  return (
    /^(context used|unavailable context|context quality|context caution|draft or placeholder notes|graph hints|graph status|graph hint refs|runtime note|remote cmo adapter|cmo context pack)/i.test(line) ||
    /\b(saved to vault|raw capture|context refs|session:\s*session_|vault path|vault_path|record id|record_id|target path|target_path|content_hash|approval_payload_hash|idempotency_key|gbrain_index|promotion_performed|side_effects|dry-run|receipt)\b/i.test(line) ||
    /\b(vault_agent\.approved_write_result\.v1|vault_agent\.approved_write_dry_run\.v1|12 Knowledge|13 Sources|90 Runtime|sha256:)\b/i.test(line) ||
    /\bsource:\s*[^.]+\.md\b/i.test(line) ||
    /\b[A-Z][^:\n]*\/[^:\n]+\.md\b/.test(line) ||
    /\b[A-Z][\w -]+\.md\b/.test(line)
  );
}

function isBackendContextHeading(value: string): boolean {
  return /^(context used|context|runtime note|graph hints|graph context|system context)$/i.test(value.trim());
}

function normalizeRepeatedOrderedListStartsForDisplay(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const repeatedTopLevelOneCount = lines.filter((line) => /^1\.\s+\S/.test(line)).length;
  const hasTopLevelOrderedContinuation = lines.some((line) => /^[2-9]\d*\.\s+\S/.test(line));

  if (repeatedTopLevelOneCount < 3 || hasTopLevelOrderedContinuation) {
    return markdown;
  }

  let nextNumber = 0;

  return lines
    .map((line) => {
      if (!/^1\.\s+\S/.test(line)) {
        return line;
      }

      nextNumber += 1;
      return line.replace(/^1\./, `${nextNumber}.`);
    })
    .join("\n");
}

export function assistantDisplayMarkdown(content: string): string {
  const safeMarkdown = content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      const heading = trimmed.match(/^#{1,6}\s+(.+)$/);

      if (heading && isBackendContextHeading(heading[1])) {
        return false;
      }

      return !isBackendContextLine(trimmed);
    })
    .join("\n")
    .trim();

  return normalizeRepeatedOrderedListStartsForDisplay(safeMarkdown);
}
