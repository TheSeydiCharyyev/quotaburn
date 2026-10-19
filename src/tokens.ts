/**
 * Token estimation for content the logs do not count for us.
 *
 * Text: the tokenizer introduced with Claude Opus 4.7 fits roughly 2.5M Unicode
 * characters in 1M tokens; models up to Claude Sonnet 4.6 fit about 4 characters
 * per token (platform.claude.com/docs/en/about-claude/models/overview, and the
 * tokenizer note on the pricing page). Tool output is code and JSON, which packs
 * denser than prose, so these figures are a floor, not a billing number.
 *
 * Images: a tool result carries an image as base64 text, whose length says
 * nothing about its cost — Claude prices an image by its pixels, after scaling
 * it so the long edge is at most 1568px and the area at most ~1.15MP:
 *
 *   tokens ~= width * height / 750
 *
 * Sizing an image by its base64 length overstates it by one to two orders of
 * magnitude, which is enough to put the tool that reads screenshots on top of
 * the residency ranking on its own.
 */

export const CHARS_PER_TOKEN_CURRENT = 2.5;
export const CHARS_PER_TOKEN_LEGACY = 4;

const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1_150_000;
const PIXELS_PER_TOKEN = 750;
/** used when an image's dimensions cannot be read from its header */
export const IMAGE_TOKENS_FALLBACK = 1600;

/**
 * Which tokenizer a model uses. Generations up to 4.6 use the previous one,
 * 4.7 and later the current one.
 */
export function charsPerTokenFor(model: string | undefined): number {
  if (!model) return CHARS_PER_TOKEN_CURRENT;
  const parts = model.split('-');
  // claude-<family>-<major>[-<minor>][-<date>]
  const major = Number(parts[2]);
  if (!Number.isFinite(major)) return CHARS_PER_TOKEN_CURRENT;
  const minor = Number.isFinite(Number(parts[3])) ? Number(parts[3]) : 0;
  if (major < 4) return CHARS_PER_TOKEN_LEGACY;
  if (major === 4 && minor <= 6) return CHARS_PER_TOKEN_LEGACY;
  return CHARS_PER_TOKEN_CURRENT;
}

function textTokens(text: string, charsPerToken: number): number {
  return Math.round(text.length / charsPerToken);
}

/** Dimensions from a PNG, JPEG or GIF header; null when the format is unknown. */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR with width and height as big-endian uint32
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF8", then width and height as little-endian uint16
  if (buf.length >= 10 && buf.toString('ascii', 0, 4) === 'GIF8') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG: walk the segment chain to a start-of-frame marker
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1] ?? 0;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** What Claude charges for an image of these pixel dimensions, after API downscaling. */
export function imageTokensFromDimensions(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return IMAGE_TOKENS_FALLBACK;
  const scale = Math.min(
    1,
    MAX_LONG_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
  return Math.max(1, Math.round((width * scale * (height * scale)) / PIXELS_PER_TOKEN));
}

function imageBlockTokens(source: Record<string, unknown>): number {
  const data = source['data'];
  if (typeof data !== 'string' || data.length === 0) return IMAGE_TOKENS_FALLBACK;
  // the header is all we need, and base64 decodes in 4-char groups
  const head = data.slice(0, 512);
  let buf: Buffer;
  try {
    buf = Buffer.from(head.slice(0, head.length - (head.length % 4)), 'base64');
  } catch {
    return IMAGE_TOKENS_FALLBACK;
  }
  const dims = imageDimensions(buf);
  return dims ? imageTokensFromDimensions(dims.width, dims.height) : IMAGE_TOKENS_FALLBACK;
}

/**
 * Estimated tokens a piece of tool-result content adds to the context window.
 * Image blocks are sized by their pixels; everything else by character count.
 */
export function estimateContentTokens(value: unknown, charsPerToken: number): number {
  if (value == null) return 0;
  if (typeof value === 'string') return textTokens(value, charsPerToken);
  if (Array.isArray(value)) {
    let sum = 0;
    for (const item of value) sum += estimateContentTokens(item, charsPerToken);
    return sum;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj['type'] === 'image') {
      const source = obj['source'];
      return typeof source === 'object' && source !== null
        ? imageBlockTokens(source as Record<string, unknown>)
        : IMAGE_TOKENS_FALLBACK;
    }
    if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
      return textTokens(obj['text'], charsPerToken);
    }
    return textTokens(JSON.stringify(value), charsPerToken);
  }
  return textTokens(String(value), charsPerToken);
}
