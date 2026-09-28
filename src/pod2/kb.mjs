import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

function tokenize(text) {
  const out = [];
  const clean = String(text || '').toLowerCase();
  let ascii = '';
  for (const ch of clean) {
    if (/[a-z0-9]/.test(ch)) {
      ascii += ch;
      continue;
    }
    if (ascii) {
      out.push(ascii);
      ascii = '';
    }
    if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
  }
  if (ascii) out.push(ascii);
  const bigrams = [];
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i].length === 1 && out[i + 1].length === 1) bigrams.push(out[i] + out[i + 1]);
  }
  return [...out, ...bigrams];
}

class Index {
  constructor(entries) {
    this.entries = entries;
    this.docs = entries.map((entry) => tokenize([entry.source, entry.article, entry.topic, entry.text, [].concat(entry.tags || []).join(' ')].join(' ')));
    this.avg = this.docs.reduce((a, d) => a + d.length, 0) / (this.docs.length || 1);
    this.df = new Map();
    this.docs.forEach((doc) => {
      new Set(doc).forEach((term) => this.df.set(term, (this.df.get(term) || 0) + 1));
    });
  }

  search(query, limit = 3) {
    const terms = tokenize(query);
    const k1 = 1.4;
    const b = 0.75;
    const scored = this.docs.map((doc, id) => {
      const freq = new Map();
      doc.forEach((term) => freq.set(term, (freq.get(term) || 0) + 1));
      let score = 0;
      for (const term of new Set(terms)) {
        const tf = freq.get(term) || 0;
        if (!tf) continue;
        const df = this.df.get(term) || 0;
        const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / this.avg))));
      }
      return { entry: this.entries[id], score: Number(score.toFixed(3)) };
    });
    return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, limit);
  }
}

let index;
let meta;

export function loadKb() {
  if (index) return index;
  const doc = JSON.parse(fs.readFileSync(path.join(DATA, 'kb_laws.json'), 'utf8'));
  meta = doc.meta;
  index = new Index(doc.entries);
  index.meta = doc.meta;
  index.all = doc.entries;
  return index;
}

export function kbMeta() {
  loadKb();
  return { meta, size: index.all.length };
}

export function kbEntry(id) {
  loadKb();
  return index.all.find((entry) => entry.id === id) || null;
}

export function retrieve(query, limit = 3) {
  return loadKb().search(query, limit);
}