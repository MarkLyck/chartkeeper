import { CHANNEL_KINDS } from './channels';
import { CYCLE_KINDS } from './cycles';
import { ELLIOTT_KINDS } from './elliott';
import { FIB_KINDS } from './fib';
import { FIB_TIME_KINDS } from './fibTime';
import { FREEHAND_KINDS } from './freehand';
import { GANN_KINDS } from './gann';
import type { DrawingKind } from './kind';
import { LABEL_KINDS } from './labels';
import { LINE_KINDS } from './lines';
import { MARK_KINDS } from './marks';
import { MEASURE_KINDS } from './measures';
import { PATTERN_KINDS } from './patterns';
import { POSITION_KINDS } from './positions';
import { SHAPE_KINDS } from './shapes';
import { TEXT_KINDS } from './text';

export type { AxisLabel, DrawingKind } from './kind';

/** TradingView tool type -> renderer, one map per family file. Supporting a new tool is one entry in its family's map. */
export const DRAWING_KINDS: Readonly<Record<string, DrawingKind>> = {
  ...LINE_KINDS,
  ...CHANNEL_KINDS,
  ...FIB_KINDS,
  ...FIB_TIME_KINDS,
  ...GANN_KINDS,
  ...PATTERN_KINDS,
  ...ELLIOTT_KINDS,
  ...CYCLE_KINDS,
  ...SHAPE_KINDS,
  ...FREEHAND_KINDS,
  ...TEXT_KINDS,
  ...LABEL_KINDS,
  ...MARK_KINDS,
  ...POSITION_KINDS,
  ...MEASURE_KINDS,
};
