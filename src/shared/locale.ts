import type { Lang } from './api';

/** The Intl locale for dates and numbers, the same in the window and the chart viewer. */
export const localeOf = (lang: Lang): string => (lang === 'da' ? 'da-DK' : 'en-GB');
