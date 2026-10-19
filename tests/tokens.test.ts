import { describe, expect, test } from 'vitest';
import {
  CHARS_PER_TOKEN_CURRENT,
  CHARS_PER_TOKEN_LEGACY,
  IMAGE_TOKENS_FALLBACK,
  charsPerTokenFor,
  estimateContentTokens,
  imageDimensions,
  imageTokensFromDimensions,
} from '../src/tokens.js';

const png = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const jpeg = (w: number, h: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const imageBlock = (header: Buffer, padChars = 0): unknown => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: header.toString('base64') + 'A'.repeat(padChars) },
});

describe('charsPerTokenFor', () => {
  test('4.7 and later use the current tokenizer', () => {
    expect(charsPerTokenFor('claude-opus-5-5')).toBe(CHARS_PER_TOKEN_CURRENT);
    expect(charsPerTokenFor('claude-fable-5-1')).toBe(CHARS_PER_TOKEN_CURRENT);
    expect(charsPerTokenFor('claude-opus-4-7')).toBe(CHARS_PER_TOKEN_CURRENT);
    expect(charsPerTokenFor('claude-opus-4-8')).toBe(CHARS_PER_TOKEN_CURRENT);
  });

  test('Sonnet 4.6 and earlier use the previous tokenizer', () => {
    expect(charsPerTokenFor('claude-sonnet-4-6')).toBe(CHARS_PER_TOKEN_LEGACY);
    expect(charsPerTokenFor('claude-haiku-4-5-20251001')).toBe(CHARS_PER_TOKEN_LEGACY);
    expect(charsPerTokenFor('claude-haiku-3-5')).toBe(CHARS_PER_TOKEN_LEGACY);
  });

  test('an unreadable model id falls back to the current tokenizer', () => {
    expect(charsPerTokenFor(undefined)).toBe(CHARS_PER_TOKEN_CURRENT);
    expect(charsPerTokenFor('<synthetic>')).toBe(CHARS_PER_TOKEN_CURRENT);
  });
});

describe('image sizing', () => {
  test('reads PNG, JPEG and GIF headers', () => {
    expect(imageDimensions(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageDimensions(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
    const gif = Buffer.alloc(10);
    gif.write('GIF8', 0, 'ascii');
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(240, 8);
    expect(imageDimensions(gif)).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(Buffer.from('not an image at all'))).toBeNull();
  });

  test('a small image costs pixels / 750', () => {
    expect(imageTokensFromDimensions(300, 200)).toBe(80);
  });

  test('a large image is downscaled before being counted', () => {
    // 1920x1080 is capped by the ~1.15MP area limit, so well under 1920*1080/750 = 2765
    const tokens = imageTokensFromDimensions(1920, 1080);
    expect(tokens).toBeGreaterThan(1450);
    expect(tokens).toBeLessThan(1600);
  });

  test('a screenshot is sized by its pixels, not by its base64 length', () => {
    // 100k characters of base64 would be 40,000 tokens at 2.5 chars/token
    const tokens = estimateContentTokens(imageBlock(png(300, 200), 100_000), CHARS_PER_TOKEN_CURRENT);
    expect(tokens).toBe(80);
  });

  test('an image whose header cannot be read gets the documented fallback', () => {
    const block = { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'QUJDREVGR0g=' } };
    expect(estimateContentTokens(block, CHARS_PER_TOKEN_CURRENT)).toBe(IMAGE_TOKENS_FALLBACK);
  });
});

describe('estimateContentTokens', () => {
  test('text uses the tokenizer it is given', () => {
    const text = 'x'.repeat(1000);
    expect(estimateContentTokens(text, CHARS_PER_TOKEN_CURRENT)).toBe(400);
    expect(estimateContentTokens(text, CHARS_PER_TOKEN_LEGACY)).toBe(250);
  });

  test('mixed content sums text and images', () => {
    const content = [
      { type: 'text', text: 'y'.repeat(500) }, // 200 tokens
      imageBlock(png(300, 200), 50_000), // 80 tokens
    ];
    expect(estimateContentTokens(content, CHARS_PER_TOKEN_CURRENT)).toBe(280);
  });

  test('empty and missing content is zero', () => {
    expect(estimateContentTokens(null, CHARS_PER_TOKEN_CURRENT)).toBe(0);
    expect(estimateContentTokens(undefined, CHARS_PER_TOKEN_CURRENT)).toBe(0);
    expect(estimateContentTokens('', CHARS_PER_TOKEN_CURRENT)).toBe(0);
  });
});
