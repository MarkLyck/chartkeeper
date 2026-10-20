import { LOCALE } from '../shared/locale';
import type { Manifest, ManifestLayout } from './model';

/** Plain-language notes for someone who opens a backup folder outside ChartKeeper. Not part of the manifest's files. */
export const README_FILE = 'README.txt';

const num = (n: number) => n.toLocaleString(LOCALE);

/** A layout can show hundreds of symbols; the README names the first few. */
const SHOWN_SYMBOLS = 10;

const DO_NOT_EDIT = [
  'Please do not change, move or rename anything in this folder. ChartKeeper',
  'needs the files exactly as they are to show and restore your charts.',
];

export const BACKUP_FOLDER_README = [
  'ChartKeeper backups',
  '===================',
  '',
  'Each backup ChartKeeper takes is a folder inside "snapshots", named by the',
  'date and time it was taken, for example "2026-10-17_18-00-00". A backup that',
  'did not finish has "-INCOMPLETE" at the end of its name.',
  '',
  'Each backup folder has its own README.txt. It lists your layouts by their',
  'TradingView names and says which folder holds each one.',
  '',
  'To look at your charts, open ChartKeeper and click "View my backups".',
  '',
  ...DO_NOT_EDIT,
  '',
].join('\n');

function symbolsText(symbols: string[]): string {
  if (symbols.length === 0) return '0';
  const more = symbols.length > SHOWN_SYMBOLS ? `, and ${num(symbols.length - SHOWN_SYMBOLS)} more` : '';
  return `${num(symbols.length)} (${symbols.slice(0, SHOWN_SYMBOLS).join(', ')}${more})`;
}

const layoutLines = (l: ManifestLayout) => [
  `“${l.name}”`,
  `  Folder:      ${l.dir}`,
  `  Charts:      ${num(l.charts)}`,
  `  Drawings:    ${num(l.drawings)}`,
  `  Symbols:     ${symbolsText(l.symbols)}`,
  `  Indicators:  ${num(l.studies)}`,
  `  Prices:      ${l.priceData ? 'saved, so the charts can be viewed without internet' : 'not saved'}`,
  '',
];

export function snapshotReadme(m: Manifest): string {
  const taken = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(m.createdAt));
  const extras: [string, number, string][] = [
    ['Indicator templates', m.extras.studyTemplates, 'templates/study-templates.json'],
    ['Drawing templates', m.extras.drawingTemplates, 'templates/drawing-templates.json'],
    ['Colour themes', m.extras.themes, 'templates/themes.json'],
    ['Pine scripts', m.extras.scripts, 'scripts/'],
    ['Drawings kept outside layouts', m.extras.userDrawings, 'user-drawings.json'],
  ];
  return [
    'ChartKeeper backup of your TradingView charts',
    '=============================================',
    '',
    ...(m.status === 'incomplete'
      ? ['THIS BACKUP DID NOT FINISH. Do not rely on it.', 'It holds only what was saved before it stopped.', `Why it stopped: ${m.error ?? 'unknown'}`, '']
      : []),
    `Taken: ${taken}`,
    `TradingView account: ${m.account.username}`,
    '',
    'To look at these charts, open ChartKeeper and click "View my backups".',
    'To put a chart back on TradingView, click "Restore a chart".',
    '',
    ...DO_NOT_EDIT,
    '',
    '',
    `LAYOUTS (${num(m.layouts.length)})`,
    '',
    ...(m.layouts.length === 0
      ? ['This backup has no layouts.', '']
      : [
          'Each layout is in its own folder inside "layouts". TradingView gives every',
          'layout a short id, and the folder is named by that id, not by the layout\'s',
          'name. This list says which folder is which layout.',
          '',
          ...m.layouts.flatMap(layoutLines),
        ]),
    '',
    'WHAT A LAYOUT FOLDER HOLDS',
    '',
    '  layout.json     the layout: its charts, symbols, indicators and settings',
    '  drawings.json   every drawing on the layout, on all its symbols',
    '  data/           prices and indicator values, so the charts can be viewed',
    '                  without internet (only when prices were saved)',
    '',
    '',
    'ALSO SAVED',
    '',
    ...extras.map(([what, n, file]) => `  ${`${what}:`.padEnd(31)}${num(n).padEnd(8)}${file}`),
    '',
    'manifest.json lists every file of this backup with a checksum.',
    '',
  ].join('\n');
}
