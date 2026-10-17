import { z } from 'zod';
import { TvContentSchema } from './tv/content';

/**
 * On-disk snapshot format. One snapshot is one folder:
 *
 *   <root>/snapshots/<YYYY-MM-DD_HH-mm-ss>/
 *     manifest.json
 *     account.json
 *     layouts/<uid>/layout.json      LayoutRecord
 *     layouts/<uid>/drawings.json    DrawingsRecord
 *     layouts/<uid>/data/chart-<chartId>.json  ChartData (prices + indicator values)
 *     user-drawings.json             DrawingBucket (drawings synced to all layouts)
 *     templates/study-templates.json, drawing-templates.json, themes.json
 *     scripts/index.json, scripts/<file>.pine
 *
 * Everything is plain JSON so a person can open it in a text editor.
 * Bump FORMAT_VERSION when a file changes shape.
 */
export const FORMAT_VERSION = 1;

const looseObject = z.record(z.string(), z.unknown());

export const DrawingBucketSchema = z.object({
  /** Drawing id -> stored drawing as returned by TradingView's drawing storage. */
  sources: z.record(z.string(), looseObject),
  drawing_groups: z.record(z.string(), z.unknown()).default({}),
});
export type DrawingBucket = z.infer<typeof DrawingBucketSchema>;

export const DrawingsRecordSchema = z.object({
  /** Keyed by storage chart id: "1", "2", ... or "_shared". */
  buckets: z.record(z.string(), DrawingBucketSchema),
  /** Drawing counts TradingView reported for this layout, used to check completeness. */
  reportedTotal: z.number().nullable(),
});
export type DrawingsRecord = z.infer<typeof DrawingsRecordSchema>;

export const LayoutRecordSchema = z.object({
  uid: z.string().min(1),
  id: z.number().nullable(),
  name: z.string(),
  description: z.string().default(''),
  lastModified: z.number().nullable(),
  /** The layout JSON (TradingView's `content`), parsed. */
  content: TvContentSchema,
  /** TradingView's `study_meta_info_map`: study id -> plot/input definitions. */
  studyMetaInfoMap: z.record(z.string(), looseObject),
  /** The entry from the layout list, kept verbatim. */
  listEntry: looseObject,
});
export type LayoutRecord = z.infer<typeof LayoutRecordSchema>;

/** [time (unix seconds), open, high, low, close, volume] */
export const BarSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
export type Bar = z.infer<typeof BarSchema>;

export const StudyValuesSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    metaInfoId: z.string(),
    /** [time, plot0, plot1, ...] in the order of the study's metaInfo.plots. null = no value. */
    rows: z.array(z.array(z.number().nullable())),
    /** Raw Pine graphics (labels, boxes, lines drawn by scripts). Stored, not drawn by the viewer. */
    graphics: z.unknown().optional(),
  }),
  z.object({ status: z.literal('error'), metaInfoId: z.string(), error: z.string() }),
]);
export type StudyValues = z.infer<typeof StudyValuesSchema>;

export const ChartDataSchema = z.object({
  chartId: z.string(),
  symbol: z.string(),
  interval: z.string(),
  fetchedAt: z.string(),
  bars: z.array(BarSchema),
  /** Keyed by the study's source id in the layout. */
  studies: z.record(z.string(), StudyValuesSchema),
});
export type ChartData = z.infer<typeof ChartDataSchema>;

export const ManifestLayoutSchema = z.object({
  uid: z.string(),
  name: z.string(),
  dir: z.string(),
  symbols: z.array(z.string()),
  charts: z.number(),
  drawings: z.number(),
  studies: z.number(),
  lastModified: z.number().nullable(),
  priceData: z.boolean(),
});
export type ManifestLayout = z.infer<typeof ManifestLayoutSchema>;

export const ManifestSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  app: z.object({ name: z.string(), version: z.string() }),
  createdAt: z.string(),
  status: z.enum(['complete', 'incomplete']),
  error: z.string().optional(),
  account: z.object({ username: z.string(), plan: z.string().nullable() }),
  layouts: z.array(ManifestLayoutSchema),
  extras: z.object({
    studyTemplates: z.number(),
    drawingTemplates: z.number(),
    themes: z.number(),
    scripts: z.number(),
    userDrawings: z.number(),
  }),
  warnings: z.array(z.string()),
  /** Relative path -> sha256 of every file in the snapshot except the manifest. */
  files: z.record(z.string(), z.object({ sha256: z.string(), bytes: z.number() })),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const StudyTemplatesFileSchema = z.object({ templates: z.array(looseObject) });
export const DrawingTemplatesFileSchema = z.object({
  /** LineTool name -> template name -> template content */
  tools: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export const ThemesFileSchema = z.object({ themes: z.record(z.string(), z.unknown()) });
export const ScriptsIndexSchema = z.object({
  scripts: z.array(
    z.object({ id: z.string(), name: z.string(), version: z.string(), file: z.string(), meta: looseObject }),
  ),
});
