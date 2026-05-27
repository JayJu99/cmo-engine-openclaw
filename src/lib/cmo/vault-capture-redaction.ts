const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string; type: string }> = [
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, replacement: "Bearer [REDACTED:token]", type: "bearer_token" },
  { pattern: /\b(authorization\s*[:=]\s*)(Bearer\s+)?[^\s\n]+/gi, replacement: "$1[REDACTED:authorization]", type: "authorization" },
  { pattern: /\b(api[_-]?key|oauth[_-]?token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret)\s*[:=]\s*['"]?[^'"\s\n]{8,}['"]?/gi, replacement: "$1=[REDACTED:secret]", type: "secret" },
  { pattern: /\bcookie\s*[:=]\s*[^\n]+/gi, replacement: "cookie=[REDACTED:cookie]", type: "cookie" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED:private-key]", type: "private_key" },
  { pattern: /\b(seed phrase|mnemonic)\s*[:=]\s*(?:\w+\s+){11,23}\w+/gi, replacement: "$1=[REDACTED:seed-phrase]", type: "seed_phrase" },
  { pattern: /\b[A-Za-z0-9_-]{48,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED:jwt]", type: "jwt" },
  { pattern: /\b(?!(?:https?|ftp):)[A-Za-z0-9_\-]{64,}\b/g, replacement: "[REDACTED:long-token]", type: "long_token" },
];

export interface RedactionResult {
  text: string;
  applied: boolean;
  types: string[];
}

export function redactSensitiveTextWithMetadata(input: string | undefined): RedactionResult {
  let text = input || "";
  const types = new Set<string>();
  for (const item of REDACTION_PATTERNS) {
    item.pattern.lastIndex = 0;
    if (item.pattern.test(text)) {
      types.add(item.type);
      item.pattern.lastIndex = 0;
      text = text.replace(item.pattern, item.replacement);
    }
  }
  return { text, applied: types.size > 0, types: Array.from(types).sort() };
}

export function redactSensitiveText(input: string | undefined): string {
  return redactSensitiveTextWithMetadata(input).text;
}
