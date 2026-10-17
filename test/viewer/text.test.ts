import { describe, expect, it } from 'vitest';
import { tableGrid } from '../../src/renderer/viewer/drawings/labels';
import { iconSymbol, STICKERS } from '../../src/renderer/viewer/drawings/marks';
import { fixedPoint, textBlock } from '../../src/renderer/viewer/drawings/text';

/** 7 px per character, like a 14 px font's average advance. */
const measure = (s: string) => s.length * 7;

describe('anchored tools', () => {
  it('place themselves at positionPercents of the pane', () => {
    const at = fixedPoint({ positionPercents: { x: 0.228, y: 0.75 } }, 940, 572);
    expect(at.x).toBeCloseTo(214.32);
    expect(at.y).toBe(429);
  });

  it('read the first entry when TradingView stored a list', () => {
    expect(fixedPoint({ positionPercents: [{ x: 0.5, y: 0.25 }] }, 800, 400)).toEqual({ x: 400, y: 100 });
  });

  it('fall back to the pane centre, as TradingView does', () => {
    expect(fixedPoint({}, 800, 400)).toEqual({ x: 400, y: 200 });
  });
});

describe('text boxes', () => {
  it('pad the widest line and round the width up to an even number', () => {
    const b = textBlock(measure, 'Plain text\nab', { size: 18, padX: 2.5, padY: 3 });
    expect(b.lines).toEqual(['Plain text', 'ab']);
    expect(b.width).toBe(76);
    expect(b.height).toBe(2 * 18 + 6);
  });

  it('wrap words at wordWrapWidth and make the box that wide', () => {
    const b = textBlock(measure, 'one two three four', { size: 14, padX: 2, padY: 2, wrapWidth: 70 });
    expect(b.lines).toEqual(['one two', 'three four']);
    expect(b.width).toBe(74);
  });

  it('keep a word longer than the wrap width on its own line', () => {
    expect(textBlock(measure, 'extraordinarily long', { size: 14, padX: 0, padY: 0, wrapWidth: 50 }).lines).toEqual(['extraordinarily', 'long']);
  });
});

describe('tables', () => {
  const cells = [
    ['Ticker', 'AAPL'],
    ['Bias', 'Long'],
    ['Stop', '318'],
  ];

  it('use the stored column widths and grow rows to fit 14 px text', () => {
    expect(tableGrid(cells, [90, 90], [26, 26, 26], 14, measure)).toEqual({ xs: [0, 90, 180], ys: [0, 32, 64, 96] });
  });

  it('widen a column whose text does not fit', () => {
    const grid = tableGrid([['A much longer heading', 'x']], [90, 90], [40], 14, measure);
    expect(grid.xs).toEqual([0, 21 * 7 + 20, 21 * 7 + 20 + 90]);
    expect(grid.ys).toEqual([0, 40]);
  });

  it('cover cells beyond the stored sizes', () => {
    expect(tableGrid([['a', 'b', 'c']], [50], [], 12, measure)).toEqual({ xs: [0, 50, 77, 104], ys: [0, 30] });
  });
});

describe('icons and stickers', () => {
  it('map Font Awesome codes to Unicode symbols', () => {
    expect(iconSymbol(0xf118)).toBe('☺');
    expect(iconSymbol(0xf005)).toBe('★');
    expect(iconSymbol(1)).toBe('●');
  });

  it('draw the bitcoin sticker as a bitcoin sign on a disc', () => {
    expect(STICKERS.bitcoin).toEqual({ glyph: '₿', color: '#FBC516', disc: '#2962FF' });
  });
});
