import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

export type OutputOptions = { columns?: number; color?: boolean };
type Stream = { isTTY?: boolean; columns?: number };
export function terminalOptions(stream: Stream = process.stdout, env = process.env): OutputOptions {
  return { columns: stream.isTTY ? stream.columns : undefined, color: Boolean(stream.isTTY && env.TERM !== 'dumb' && env.NO_COLOR === undefined) };
}

// Strip supplied terminal commands before adding our own styles.
const clean = (value: string) => stripVTControlCharacters(value).replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function terminal(options: OutputOptions = terminalOptions()) {
  const width = Number.isFinite(options.columns) && options.columns! > 0 ? Math.floor(options.columns!) : 80;
  const style = (text: string, code: number) => options.color ? `\x1b[${code}m${text}\x1b[0m` : text;
  function wrap(value: string, indent = 0): string {
    const prefix = ' '.repeat(Math.min(indent, Math.max(0, width - 2)));
    const available = Math.max(1, width - prefix.length);
    return clean(value).split('\n').map(paragraph => {
      const lines: string[] = [];
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && stringWidth(`${line} ${word}`) > available) { lines.push(line); line = ''; }
        if (line) { line += ` ${word}`; continue; }
        if (/^https?:\/\//.test(word)) { line = word; continue; }
        // Split long prose without cutting a combining sequence or emoji.
        for (const { segment } of graphemes.segment(word)) {
          if (line && stringWidth(line + segment) > available) { lines.push(line); line = ''; }
          line += segment;
        }
      }
      if (line || !lines.length) lines.push(line);
      return lines.map(line => prefix + line).join('\n');
    }).join('\n');
  }
  function field(label: string, value: unknown, atomic = false): string {
    if (value === undefined || value === null || value === '') return '';
    const text = clean(String(value)), heading = clean(`${label}:`);
    const prefix = width > 4 ? '  ' : '';
    if (stringWidth(`${prefix}${heading} ${text}`) <= width && !text.includes('\n')) {
      return `${prefix}${style(heading, 2)} ${atomic ? style(text, 36) : text}`;
    }
    // IDs and URLs stay intact for copying, even on terminals narrower than the value.
    return `${style(wrap(heading, 2), 2)}\n${atomic ? style(prefix + text, 36) : wrap(text, 4)}`;
  }
  return {
    text: wrap,
    title: (value: string, indent = 0) => style(wrap(value, indent), 1),
    muted: (value: string, indent = 0) => style(wrap(value, indent), 2),
    error: (value: string) => style(wrap(value), 31),
    success: (value: string) => style(wrap(value), 32),
    field,
    record: (title: string, fields: string[]) => [style(wrap(title), 1), ...fields.filter(Boolean)].join('\n'),
    sections: (sections: string[]) => sections.join(`\n${style('─'.repeat(Math.min(48, width)), 2)}\n`),
  };
}
