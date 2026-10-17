/** Every TradingView URL ChartKeeper uses. See docs/INVESTIGATION.md for where each one came from. */
export const ORIGIN = 'https://www.tradingview.com';
export const CHART_STORAGE = 'https://charts-storage.tradingview.com/charts-storage';
export const PINE_FACADE = 'https://pine-facade.tradingview.com/pine-facade';
export const DATA_SOCKET = 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart';

/** Hosts ChartKeeper may contact. Anything else is refused by the session layer. */
export const ALLOWED_HOSTS = ['tradingview.com', 'www.tradingview.com', 'charts-storage.tradingview.com', 'pine-facade.tradingview.com', 'data.tradingview.com'];

export const isAllowedUrl = (url: string): boolean => {
  const u = new URL(url);
  return (u.protocol === 'https:' || u.protocol === 'wss:') && ALLOWED_HOSTS.includes(u.hostname);
};

/** The cookie that carries the TradingView sign-in. */
export const SESSION_COOKIE = 'sessionid';

/** tradingview.com or one of its subdomains. Cookie domains may start with a dot. */
export const isTradingViewHost = (host: string): boolean => {
  const h = host.replace(/^\./, '');
  return h === 'tradingview.com' || h.endsWith('.tradingview.com');
};

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const urls = {
  /** A light page whose globals (`window.user`, `BUILD_TIME`) we read and whose origin requests run from. */
  home: `${ORIGIN}/`,
  signIn: `${ORIGIN}/accounts/signin/`,
  myCharts: `${ORIGIN}/my-charts/`,
  chartCount: `${ORIGIN}/api/v1/charts/count/`,
  layoutJson: (url: string) => `${ORIGIN}/chart/${encodeURIComponent(url)}/json/`,
  layoutPage: (url: string) => `${ORIGIN}/chart/${encodeURIComponent(url)}/`,
  saveLayout: `${ORIGIN}/api/v1/charts/save/`,
  chartToken: (uid: string, userId: number) => `${ORIGIN}/chart-token/?${q({ image_url: uid, user_id: String(userId) })}`,
  layoutSources: (uid: string, chartId: string, jwt: string) => `${CHART_STORAGE}/get/layout/${encodeURIComponent(uid)}/sources?${q({ chart_id: chartId, layout_id: uid, jwt })}`,
  putLayoutSources: (uid: string, chartId: string, jwt: string) => `${CHART_STORAGE}/layout/${encodeURIComponent(uid)}/sources?${q({ chart_id: chartId, layout_id: uid, jwt })}`,
  layoutSizes: (uid: string, jwt: string) => `${CHART_STORAGE}/layout/${encodeURIComponent(uid)}/sizes?${q({ layout_id: uid, jwt })}`,
  userSources: (uid: string, jwt: string) => `${CHART_STORAGE}/get/user/sources?${q({ layout_id: uid, jwt })}`,
  studyTemplates: `${ORIGIN}/api/v1/study-templates`,
  studyTemplate: (id: number | string) => `${ORIGIN}/api/v1/study-templates/${encodeURIComponent(String(id))}`,
  drawingTemplates: (tool: string) => `${ORIGIN}/drawing-templates/${encodeURIComponent(tool)}/`,
  drawingTemplate: (tool: string, name: string) => `${ORIGIN}/drawing-template/${encodeURIComponent(tool)}/?${q({ templateName: name })}`,
  saveDrawingTemplate: `${ORIGIN}/save-drawing-template/`,
  themes: `${ORIGIN}/themes/`,
  saveTheme: `${ORIGIN}/save-theme/`,
  theme: (name: string) => `${ORIGIN}/theme/?${q({ themeName: name })}`,
  pineList: `${PINE_FACADE}/list?filter=saved`,
  pineScript: (id: string, version: string) => `${PINE_FACADE}/get/${encodeURIComponent(id)}/${encodeURIComponent(version)}`,
};

/**
 * Drawing tools that can have saved templates. From TradingView's
 * `supportedLineTools` table (bundle 3233, module 899801).
 */
export const TEMPLATE_TOOLS = [
  'LineToolTrendLine', 'LineToolRay', 'LineToolExtended', 'LineToolInfoLine', 'LineToolTrendAngle', 'LineToolArrow',
  'LineToolHorzLine', 'LineToolHorzRay', 'LineToolVertLine', 'LineToolCrossLine', 'LineToolParallelChannel',
  'LineToolDisjointAngle', 'LineToolFlatBottom', 'LineToolRegressionTrend', 'LineToolPitchfork', 'LineToolSchiffPitchfork',
  'LineToolSchiffPitchfork2', 'LineToolInsidePitchfork', 'LineToolPitchfan', 'LineToolGannSquare', 'LineToolGannComplex',
  'LineToolGannFixed', 'LineToolGannFan', 'LineToolFibRetracement', 'LineToolTrendBasedFibExtension',
  'LineToolFibSpeedResistanceFan', 'LineToolFibTimeZone', 'LineToolTrendBasedFibTime', 'LineToolFibCircles',
  'LineToolFibSpiral', 'LineToolFibSpeedResistanceArcs', 'LineToolFibWedge', 'LineToolFibChannel', 'LineToolRectangle',
  'LineToolRotatedRectangle', 'LineToolEllipse', 'LineToolCircle', 'LineToolTriangle', 'LineToolPolyline', 'LineToolPath',
  'LineToolArc', 'LineToolCurve', 'LineToolDoubleCurve', 'LineToolBrush', 'LineToolHighlighter', 'LineToolText',
  'LineToolTextAbsolute', 'LineToolNote', 'LineToolNoteAbsolute', 'LineToolCallout', 'LineToolBalloon', 'LineToolComment',
  'LineToolPriceLabel', 'LineToolPriceNote', 'LineToolSignpost', 'LineToolFlagMark', 'LineToolArrowMarker',
  'LineToolArrowMarkUp', 'LineToolArrowMarkDown', 'LineToolArrowMarkLeft', 'LineToolArrowMarkRight', 'LineToolPriceRange',
  'LineToolDateRange', 'LineToolDateAndPriceRange', 'LineToolRiskRewardLong', 'LineToolRiskRewardShort',
  'LineToolPrediction', 'LineToolBarsPattern', 'LineToolGhostFeed', 'LineToolProjection', 'LineToolAnchoredVWAP',
  'LineToolFixedRangeVolumeProfile', 'LineToolElliottImpulse', 'LineToolElliottCorrection', 'LineToolElliottTriangle',
  'LineToolElliottDoubleCombo', 'LineToolElliottTripleCombo', 'LineToolHeadAndShoulders', 'LineToolABCD',
  'LineToolTrianglePattern', 'LineTool5PointsPattern', 'LineToolThreeDrivers', 'LineToolCypherPattern',
  'LineToolTimeCycles', 'LineToolCircleLines', 'LineToolSineLine', 'LineToolTable', 'LineToolIcon', 'LineToolEmoji',
];

/** Saved-layout limits per plan, from TradingView's pricing page. null = unlimited. */
export const PLAN_LAYOUT_LIMITS: Record<string, number | null> = {
  free: 1,
  essential: 5,
  pro: 5,
  plus: 10,
  pro_plus: 10,
  premium: null,
  pro_premium: null,
  ultimate: null,
  pro_ultimate: null,
};
