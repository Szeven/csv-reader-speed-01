// csv-reader-speed-01: a faster drop-in for make.fun's own csv-reader 1.0.0.
// run(input) returns exactly csv-reader 1.0.0's answer {columns, rows, errors}
// for every input {text, header}, with the same broken-row policy:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded (short_row) or cut (long_row) to the first
//     record's width; each error is {code, line, row}, line the 1-based line its
//     record starts on, row its record's index in rows (null for the header).
//
// Speed: a record-level fast path (a record with no quote and no stray CR is
// split natively) and an indexOf-based general path that slices field values
// instead of building them one character at a time. No regex in the hot path
// (one global CR_RUN is used only to normalize a quoted segment that holds a
// line break, and the field readers return through shared holders instead of
// allocating a result object per field).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** A CR, with an LF after it when there is one. */
const CR_RUN = /\r\n?/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // The last field read: its value, how it ended, and how many characters the
  // reader kept (readUnquoted and readQuoted write these, parseRecordSlow
  // reads them, so no result object is allocated per field).
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). The next delimiter is the
  // nearer of the next comma and the next line feed; a CR inside the slice is
  // found on the slice itself, so no scan ever runs past the field.
  function readUnquoted(value) {
    let added = 0;
    let parts = null;
    while (pos < len) {
      let c = text.indexOf(',', pos);
      let n = text.indexOf('\n', pos);
      if (c === -1) c = len;
      if (n === -1) n = len;
      const end = c < n ? c : n;
      const seg = end > pos ? text.slice(pos, end) : '';
      const r = seg.indexOf('\r');
      if (r !== -1) {
        // A CR inside the field: keep what is before it, then handle it.
        if (r > 0) {
          const head = seg.slice(0, r);
          added += head.length;
          if (parts) parts.push(head);
          else if (value === '') value = head;
          else { parts = [value, head]; value = ''; }
        }
        const at = pos + r;
        if (at + 1 < len && text.charCodeAt(at + 1) === 10) {
          pos = at + 2;
          line += 1;
          fValue = parts ? parts.join('') : value;
          fEnded = LINE_BREAK;
          fAdded = added;
          return;
        }
        error('stray_cr');
        if (!parts) { parts = [value]; value = ''; }
        pos = at + 1;
        continue;
      }
      if (seg !== '') {
        added += seg.length;
        if (parts) parts.push(seg);
        else if (value === '') value = seg;
        else { parts = [value, seg]; value = ''; }
      }
      if (end >= len) {
        pos = len;
        fValue = parts ? parts.join('') : value;
        fEnded = END;
        fAdded = added;
        return;
      }
      if (end === c) {
        pos = end + 1;
        fValue = parts ? parts.join('') : value;
        fEnded = COMMA;
        fAdded = added;
        return;
      }
      pos = end + 1;
      line += 1;
      fValue = parts ? parts.join('') : value;
      fEnded = LINE_BREAK;
      fAdded = added;
      return;
    }
    fValue = parts ? parts.join('') : value;
    fEnded = END;
    fAdded = added;
  }

  // One quoted segment, [start, end): CRLF and lone CR inside it are each one
  // LF, and the line count moves by the line breaks it holds.
  function normalizeSegment(start, end) {
    const seg = text.slice(start, end);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) return seg;
    const norm = seg.replace(CR_RUN, '\n');
    let n = 0;
    let i = norm.indexOf('\n');
    while (i !== -1) {
      n += 1;
      i = norm.indexOf('\n', i + 1);
    }
    line += n;
    return norm;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let parts = null;
    const append = (seg) => {
      if (seg === '') return;
      if (parts) parts.push(seg);
      else if (value === '') value = seg;
      else { parts = [value, seg]; value = ''; }
    };
    let scan = pos;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        append(normalizeSegment(scan, q));
        append('"');
        scan = q + 2;
        continue;
      }
      append(normalizeSegment(scan, q));
      if (parts) value = parts.join('');
      pos = q + 1;
      break;
    }
    fValue = value;
    if (pos >= len) {
      fEnded = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
  }

  // Reads one record the general way (it holds a quote or a stray CR): returns
  // its fields and whether its last field opened with a quote.
  function parseRecordSlow() {
    const fields = [];
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);
    return { fields, lastQuoted };
  }

  while (pos < len) {
    // Lines with no characters are no records.
    const c = text.charCodeAt(pos);
    if (c === 10) {
      pos += 1;
      line += 1;
      continue;
    }
    if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      continue;
    }

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record holds no quote, and its only CR (if any) is the
    // CRLF at its end. Then it is one line split on commas.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    const lineStr = text.slice(pos, lineEnd);
    let fields = null;
    let lastQuoted = false;
    if (lineStr.indexOf('"') === -1) {
      const r = lineStr.indexOf('\r');
      if (r === -1 || (nl !== -1 && r === lineStr.length - 1)) {
        const body = r === -1 ? lineStr : lineStr.slice(0, -1);
        fields = body.split(',');
        if (nl !== -1) {
          pos = nl + 1;
          line += 1;
        } else {
          pos = len;
        }
      }
    }
    if (fields === null) {
      const rec = parseRecordSlow();
      fields = rec.fields;
      lastQuoted = rec.lastQuoted;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
