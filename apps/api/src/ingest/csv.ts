/**
 * Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, CRLF/LF, BOM).
 * Returns header-keyed records; headers are normalised to snake_case.
 */

export interface CsvTable {
  headers: string[];
  /** Data rows keyed by normalised header. `line` is the 1-based spreadsheet row (header = 1). */
  records: { line: number; values: Record<string, string> }[];
}

export const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCsv(text: string): CsvTable {
  const rows = parseRows(text.replace(/^﻿/, ''));
  const headers = (rows[0] ?? []).map(normaliseHeader);
  const records: CsvTable['records'] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue; // blank line
    const values: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) values[h] = (cells[i] ?? '').trim(); });
    records.push({ line: r + 1, values });
  }
  return { headers: headers.filter(Boolean), records };
}
