import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kbEntry } from './kb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'outputs');

const flatten = (value) => String(value || '').replace(/\s+/g, '');

export function maskPii(text) {
  return String(text || '')
    .replace(/\b\d{17}[\dXx]\b/g, (m) => m.slice(0, 6) + '*'.repeat(m.length - 10) + m.slice(-4))
    .replace(/\b1[3-9]\d{9}\b/g, (m) => m.slice(0, 3) + '****' + m.slice(-4));
}

export function verify({ findings, text, facts, kbSize }) {
  const haystack = flatten(text);
  const checked = findings.map((finding) => {
    const evidence = flatten(finding.evidence).replace(/…$/, '');
    const absence = evidence.startsWith('（全文未见');
    const quoteOk = evidence.length > 0 && (haystack.includes(evidence) || (absence && haystack.length > 0));
    const citations = finding.citations.map((citation) => {
      const live = kbEntry(citation.entry.id);
      return { ...citation, ok: !!live && live.id === citation.entry.id };
    });
    const pending = citations.filter((c) => c.entry.review === 'pending').map((c) => c.entry.id);
    let status = 'verified';
    if (!quoteOk || citations.length === 0 || citations.some((c) => !c.ok)) status = 'needs_review';
    return {
      ...finding,
      citations,
      checks: { quoteOk, kind: evidence.startsWith('（全文未见') ? 'absence' : 'quote', citationCount: citations.length, allCitationsResolve: citations.every((c) => c.ok), pendingExpertReview: pending },
      status
    };
  });
  const stats = {
    total: checked.length,
    verified: checked.filter((f) => f.status === 'verified').length,
    needsReview: checked.filter((f) => f.status === 'needs_review').length,
    pendingExpertReview: Array.from(new Set(checked.flatMap((f) => f.checks.pendingExpertReview))),
    rejected: checked.filter((f) => f.status === 'rejected').length
  };
  return { findings: checked, stats };
}

export function audit(record) {
  fs.mkdirSync(OUT, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  fs.appendFileSync(path.join(OUT, 'audit.jsonl'), line + '\n', 'utf8');
  return path.join(OUT, 'audit.jsonl');
}

export function readAudit(limit = 20) {
  const file = path.join(OUT, 'audit.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

export function saveArtifact(name, content) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}