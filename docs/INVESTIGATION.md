# How tradingview.com stores chart layouts

This document records what we found about the internal requests the
tradingview.com web app makes when it lists, opens, saves, copies and deletes
chart layouts, and when it loads prices. ChartKeeper is built on these
findings. Everything in `src/core/tv/` depends on them, and that folder is the
only place that knows TradingView URLs or response shapes.

Investigation date: 2026-10-17. TradingView web build `2026-10-16T17:55:37`.

## Method

1. We loaded `https://www.tradingview.com/chart/` in Playwright (Chromium),
   saved every JavaScript bundle the page downloaded (356 files), and recorded
   all HTTP and websocket traffic.
2. We searched the bundles for the code that talks to the server
   (`charts/save`, `my-charts`, `charts-storage`, `chart-token`,
   `drawing-templates`, `study-templates`, `pine-facade`). The request
   builders are small and readable even when minified, so each endpoint below
   cites the module it came from.
3. We called each endpoint without a session to confirm it exists and to see
   its error format.
4. We built a layout JSON with 11 drawings and 2 indicators, loaded it into a
   signed-out chart through the app's own loader
   (`TradingViewApi._chartWidgetCollection.loadLayoutState`), and read it back
   with the app's own serializer (`getSaveChartService().saveToJSON()`).
   TradingView rendered every drawing (see
   `test/fixtures/tradingview-reference.png`) and filled in all default style
   properties. The normalized result is `test/fixtures/tv-saved-layout.json`.
5. We read the smolkin.org write-up on extracting drawings (May 2026) and the
   victornpb/tradingview-backup script for the template endpoints.

We had no TradingView account during the investigation. Requests that need a
signed-in session are documented from the web app's source code and their
signed-out error responses. `test/live/roundtrip.test.ts` checks them against a
real account. Run it once with a test account before relying on restore. See
"Open risks" below.

## Accounts and sessions

- The session is two cookies on `.tradingview.com`: `sessionid` and
  `sessionid_sign`. Every request below sends them (`credentials: include`).
- The page exposes the signed-in user as `window.user` (`id`, `username`,
  `auth_token`, plan fields such as `pro_plan`).
- ChartKeeper runs every request from inside a hidden `tradingview.com` page,
  so the requests carry exactly the same cookies, origin and headers as the web
  app's own requests.

## Layouts ("chart layouts")

Source: bundle `3233.*.js`, module `908862` (`backend`), and bundle
`95474.*.js`, class `ChartSaver`.

| Action | Request | Notes |
| --- | --- | --- |
| List | `GET /my-charts/` (optional `?limit=N`) | JSON array of the user's layouts. Each entry has `id` (number), `image_url` (the short layout id, also called `uid`), `url`, `name`, and symbol fields. Signed out: `302` to the login page. |
| Count | `GET /api/v1/charts/count/` | Signed out: `403 {"detail":"Authentication credentials were not provided.","code":"not_authenticated"}`. |
| Load | `GET /chart/<url>/json/` | `{content, content_study_meta?, name, uid, last_modified, id, description, username, is_private}`. `content` is a JSON **string** with the whole layout. Unknown id: `404 {"code":"not_found","detail":"Not found"}`. |
| Save | `POST /api/v1/charts/save/` (multipart form) | See below. Returns `{id, image_url, last_modified}`. |
| Delete | `POST /api/v1/charts/delete/` with JSON `{"uid":["<image_url>"]}` | ChartKeeper never calls this. |
| Copy ("Make a copy") | Same save request without `image_url`, with a new name. | |

### Save request fields

The app builds the form in `ChartSaver._getCommonSavingInfo` and
`backend.saveChart`:

- Symbol fields of the active chart, from `chartWidgetCollection.chartsSymbols()`:
  `resolution`, `symbol_type`, `exchange`, `listed_exchange`, `symbol`,
  `short_name`, and `legs` (a JSON string).
- `name`, `description`, `is_realtime` (`"1"`).
- `content`: the layout JSON as a string. The app gzips it into a `blob.gz`
  file part when a gzip worker is available, and sends the plain string when it
  is not. The server accepts both.
- `study_meta_info_map`: JSON string, gzipped the same way.
- `image_url`: the layout id. **Present: overwrite that layout. Absent: create
  a new layout.** The app never sends `id`.
- Error handling in the app: `413` means the layout is too large, `403` with
  `code: "login_required"` means the session expired, `429` means rate limited.
  Hitting the saved-layout limit opens the `savedChartsLimit` paywall.

### Layout content

`content` (after `JSON.parse`) looks like this. Real example:
`test/fixtures/tv-saved-layout.json`.

```text
{ name, layout: "s" | "2h" | "2v" | "3h" | "4" | ...,
  charts: [ { chartId: "1", panes: [ { sources: [...], mainSourceId, stretchFactor, ... } ],
              timeScale, chartProperties, timezone, lineToolsGroups, ... } ],
  symbolLock, intervalLock, ... , layoutsSizes }
```

Pane `sources` hold:

- `{type: "MainSeries", id: "_seriesId", state: {symbol, shortName, interval, style, candleStyle, ...}}`
- Indicators: `{type: "Study" | "study_Volume" | ..., id, state: {inputs, styles, palettes, ...}, metaInfo: "BB@tv-basicstudies-280"}`.
  Since 2026, `metaInfo` is a string key into the separate
  `study_meta_info_map` (plots, inputs, defaults). Older layouts embed the full
  object.
- Drawings, when they are stored in the content:
  `{type: "LineToolTrendLine", id, state: {linecolor, linewidth, ...}, points: [{time_t, offset, price, interval}], zorder, ownerSource, linkKey}`.

## Drawings ("line tools") storage

Source: bundle `16242.*.js`, modules `355502` (`getChartStorage`), `628770`
(`getStorageTarget`), `881624` (DTO), `690261` (`LineToolsSynchronizer`).

Since 2022 the app stores most drawings outside the layout content, in a
separate service:

- Base URL from `<link rel="chart-storage" href="https://charts-storage.tradingview.com/charts-storage">`.
- Token: `GET /chart-token/?image_url=<layout id>&user_id=<user id>` returns
  `{token}` (a JWT). Signed out with an unknown layout:
  `404 {"code":"not_found","detail":"Chart with given id not found"}`.
- Read: `GET <base>/get/layout/<layout id>/sources?chart_id=<c>&layout_id=<layout id>&jwt=<token>`
  - `chart_id` is the chart number inside the layout (`1`, `2`, ...) for
    normal drawings, or `_shared` for drawings shared across the charts of the
    layout.
  - Without `symbol`, the response holds drawings for every symbol.
  - Global synced drawings ("sync drawings to all layouts") use
    `<base>/get/user/sources` with no `chart_id`.
- Write: `PUT <base>/layout/<layout id>/sources?...` with JSON
  `{sources: {<id>: dto | null}, drawing_groups: {...}, clientId}` and header
  `X-BUILD-TIME` (the page global `BUILD_TIME`). `null` removes a drawing.
- Counts: `GET <base>/layout/<layout id>/sizes?layout_id=...&jwt=...` returns
  `{charts: {<chartId>: {symbols: {<symbol>: {countSources, sizeBytes, ids}}}}, countSourcesTotal}`.
- Responses are `{success: true, payload: {sources, drawing_groups, clientId, symbol?}}`.
- The JWT alone is not enough. Without the session cookies the service answers
  `{"success": true, "payload": {"sources": {}}}`, an empty success (smolkin.org).
  ChartKeeper treats "token OK but zero drawings while `sizes` says otherwise"
  as an error.

Each stored drawing (`dto`) is
`{id, ownerSource, state, symbol?, serverUpdateTime?, currencyId, unitId, groupId?}`.
`state` is the drawing's own serialized state, which has the same shape as a
drawing source inside the layout content.

When storing drawings fails, `ChartSaver` saves the layout with the drawings
inside `content`, and the loader moves them back to storage later. ChartKeeper's
restore relies on this path (see "Restore design").

## Templates, themes and Pine scripts

| Item | List | Read one | Write (restore) |
| --- | --- | --- | --- |
| Study templates | `GET /api/v1/study-templates` → `{custom, standard, fundamentals}` | `GET /api/v1/study-templates/<id>` | `POST /api/v1/study-templates` JSON `{name, content, meta_info}` |
| Drawing templates | `GET /drawing-templates/<LineToolName>/` → `["name", ...]` | `GET /drawing-template/<LineToolName>/?templateName=<name>` → `{content: "<json>"}` | `POST /save-drawing-template/` form `name, tool, content` |
| Color themes | `GET /themes/` → names | `GET /theme/?themeName=<name>` | `POST /save-theme/` form `name, content` |
| Pine scripts | `GET https://pine-facade.tradingview.com/pine-facade/list?filter=saved` → `[{scriptIdPart, scriptName, version, ...}]` | `GET .../pine-facade/get/<scriptIdPart>/<version>` → `{source, scriptName, ...}` | Not automated. The README explains how to paste a script into the Pine editor. |

The list of drawing tool names (`LineToolTrendLine`, `LineToolFibRetracement`,
...) is in bundle `3233.*.js`, module `899801` (`supportedLineTools`).

## Prices and indicator values

Source: websocket traffic of the chart page.

- `wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart`,
  `Origin: https://www.tradingview.com`.
- Frames are `~m~<length>~m~<payload>`. A payload of `~h~<n>` is a heartbeat
  that the client must echo back.
- Messages are `{"m": <method>, "p": [params]}`:

```text
> set_auth_token      [<window.user.auth_token> | "unauthorized_user_token"]
> chart_create_session [cs]
> resolve_symbol      [cs, "sds_sym_1", "={\"adjustment\":\"splits\",\"symbol\":\"NASDAQ:AAPL\"}"]
> create_series       [cs, "sds_1", "s1", "sds_sym_1", "D", 300, ""]
< timescale_update    [cs, {"sds_1": {"s": [{"i":0,"v":[time,o,h,l,c,v]}, ...]}}]
< series_completed    [cs, "sds_1", ...]
> create_study        [cs, <studyId>, "st1", "sds_1", "BB@tv-basicstudies-280", {"length":20,"source":"close","stdDev":2}]
< du                  [cs, {<studyId>: {"st": [{"i":n,"v":[time, plot0, plot1, ...]}]}}]
< study_completed     [cs, <studyId>, ...]
< study_error         [cs, <studyId>, ..., {"ctx":{"code":"study_limit_exceeded"}, ...}]
```

`create_study` takes exactly the `metaInfo` id and `state.inputs` stored in the
layout, so TradingView's servers compute the indicator values. ChartKeeper
saves those values with the prices, and the offline viewer draws them as
TradingView computed them. That is more faithful than recomputing indicators
locally. Each subscription has a per-chart study limit, so ChartKeeper adds one
study at a time and removes it after it completes.

### The symbol string

The chart page encodes the symbol as `"="` + JSON, with the keys of every
object sorted. It builds the object from the series state:

- `symbol`, and `currency-id` when the series has a currency.
- `adjustment`: `"dividends"` when `dividendsAdjustment` is on, else `"splits"`.
- `session` only for intraday intervals, and only when it is not `"regular"`.
  Daily, weekly and monthly charts get no session. Every captured daily frame
  omits it, including frames from layouts whose state says
  `sessionId: "regular"`. The captured Range frame (interval `"1"`, regular
  session) omits it too.

Captured frames also show `"metric":"price"` on some loads. The chart page adds
it only from the browser's own "last used metric" setting (local storage), not
from the layout, so ChartKeeper leaves it out. A fresh signed-out browser sends
no metric either.

### Computed chart styles

Renko (4), Kagi (5), Point & Figure (6), Line Break (7), Heikin Ashi (8) and
Range (11) bars are computed by TradingView's servers. The chart page asks for
them by wrapping the plain symbol in the style's study and inputs:

```text
> resolve_symbol [cs, "sds_sym_3", "={\"inputs\":{\"atrLength\":14,\"boxSize\":3,...},
                  \"symbol\":{\"adjustment\":\"splits\",\"currency-id\":\"USD\",\"symbol\":\"NASDAQ:AAPL\"},
                  \"type\":\"BarSetRenko@tv-prostudies-73!\"}"]
> modify_series  [cs, "sds_1", "s2", "sds_sym_3", "D", ""]
```

- `inputs` are `state.<key>.inputs` of the main series: `renkoStyle`,
  `kagiStyle`, `pnfStyle`, `pbStyle` (Line Break), `haStyle`, `rangeStyle`.
- `type` is the style's study id plus `!`. The chart page takes the id from its
  own build (`BarSetRenko@tv-prostudies-73`, `BarSetKagi@tv-prostudies-73`,
  `BarSetPnF@tv-prostudies-73`, `BarSetPriceBreak@tv-prostudies-34`,
  `BarSetHeikenAshi@tv-basicstudies-60`, `BarSetRange@tv-basicstudies-72`). The
  layout also saves the id on the series source, outside `state`, but the chart
  page does not read it back.
- The interval is the chart's own interval string. The capture switched styles
  in the order 4, 5, 6, 7, 11, 8. Range moved the chart to `"1"`, and Heikin
  Ashi came back as `"1D"`, so `"1D"` is not specific to Heikin Ashi.

ChartKeeper resolves this symbol for `sds_sym_1`, creates the series from it,
and saves the bars with `computedStyle` set to the style id. The frames are in
`test/fixtures/tv-computed-style-frames.json`. A live signed-out run on
2026-10-17 returned bars for all six styles. For Renko, Kagi, Point & Figure,
Line Break and Heikin Ashi, every bar older than the newest three had the same
time and OHLC as the bars the chart page itself received for the gallery
scenes. Range was not compared, because its bars are built from recent trades.

Indicators on a chart in a computed style are calculated on the computed bars.
Evidence:

- Every `create_study` the chart page sends names `sds_1`, the main series, as
  its parent (see the frames above and `fixture/ws.txt` in the capture).
- When the style changes, the chart page sends only `resolve_symbol` and
  `modify_series` for `sds_1`. The capture logged every sent frame that
  mentions a series or a study. It shows no `create_study`, `modify_study` or
  `remove_study`. The default chart page has Volume, Dividends, Splits and
  Earnings studies on `sds_1` (`fixture/ws.txt`), so those studies stay on
  `sds_1`, which now carries the computed bars.

ChartKeeper also creates its studies on `sds_1`, which is the computed series.

### Study-backed drawings

Anchored VWAP (`LineToolAnchoredVWAP`) and Fixed Range Volume Profile
(`LineToolFixedRangeVolumeProfile`) are drawings that TradingView computes on
its servers. Each one is a hidden study on the main series. The line tool's
own bundle (`line-tool-anchored-vwap`, `line-tool-volume-profile`) shows the
inputs it sends:

- Anchored VWAP: `AnchoredVWAP@tv-basicstudies-280` with the saved
  `state.inputs` and `start_time` = the anchor bar's time in milliseconds.
- Fixed Range Volume Profile: `VbPFixed@tv-basicstudies-280` with the saved
  `state.inputs`, `first_bar_time` and `last_bar_time` = the two anchors in
  milliseconds (earlier first), `subscribeRealtime` = whether the right anchor
  is on the last bar, and `mapRightBoundaryToBarStartTime: true`.
- The chart page builds both study ids from its own build, like the computed
  styles.

These studies work signed out. The capture placed both tools on a signed-out
chart. It changed only the page's own sign-in check, not the connection, and
both tools drew with server-computed values (`fix3/created2.png`). The chart
page also does not count them against the plan's indicator limit
(`setIsNonCountedStudyFn`). ChartKeeper adds them one at a time like other
studies, so the limit does not apply in any case.

ChartKeeper sends these requests for every such drawing on the chart's symbol.
It saves the result in `drawingStudies`, keyed by drawing id, in the same
shape as indicator values.

A live signed-out run on 2026-10-17 (the drawings-positions gallery layout)
returned values for both:

- Anchored VWAP: 76 plot rows from the anchor bar on. The first row's VWAP is
  293.388, the anchor price TradingView saved with the drawing.
- Fixed Range Volume Profile: 37 plot rows (developing POC and value area) and
  the histogram as Pine-style graphics (`ns.d` with `graphicsCmds.create.hhists`,
  one row per price level with up and down volume). The lowest row starts at
  302.93, the drawing's lower anchor price. ChartKeeper saves `ns` as
  `graphics`.

## Terms of use

TradingView's Terms of Use (https://www.tradingview.com/policies/), checked
2026-10-17:

- Section 3 licenses content and market data "for exclusive display-only use",
  limited to "personal or internal business purposes", and forbids
  redistribution and "machine-driven processes that do not involve the direct,
  human-readable display of such data".
- Section 18 lets TradingView suspend accounts without notice.
- The terms do not mention scraping or local storage directly.

What ChartKeeper does about this:

- Layout, drawing, template and script backups are the user's own content.
- Price and indicator data is saved only to show it to the same person in the
  offline viewer. It is never exported, uploaded or shared. A setting turns the
  price cache off.
- Requests are rate limited (about one request every 1.5 to 2.5 seconds, one
  websocket series at a time) and run only on user action or once a day.
- The README states plainly that this is unofficial, uses internal endpoints,
  and that TradingView could object to automated access.

## Restore design (and the tradeoff)

Two options:

1. **Replay the save request (chosen).** `POST /api/v1/charts/save/` without
   `image_url` and with the backed-up `content` and `study_meta_info_map`. This
   creates a new layout from exactly the stored JSON. Drawings from the storage
   service are put back into `content` as pane sources, the same format
   `ChartSaver` writes when the storage service is down, so one request
   restores the whole layout. The app's loader shows them and moves them to
   storage itself.
2. **Drive the web UI.** Open the chart page, load the state into the app with
   `loadLayoutState`, then call the app's own "Save as". This reuses all of
   TradingView's save logic. It depends on private JavaScript objects, and it
   runs inside a page whose autosave can overwrite the layout that is open.

We chose option 1. It is a single request whose effect we fully control, it
never touches an existing layout unless the user confirms "Replace", and the
server stores exactly the backed-up JSON. We did not build option 2 as a
fallback, because an autosave mistake there could overwrite the user's open
layout, which is the one failure ChartKeeper must never cause.

**Replace an existing layout** sends the same request with `image_url` set,
only after an explicit confirmation, and only after ChartKeeper makes a fresh
backup of the layout it is about to replace. The saved content then holds
every backed-up drawing, so ChartKeeper removes all of that layout's drawings
from the drawing storage; otherwise old drawings would reappear on top of the
restored ones. A second confirmed "Replace" overwrites again with a new safety
copy.

**Verification** reloads the new layout with `GET /chart/<id>/json/` plus its
storage buckets, and compares the drawing ids and indicator count with the
backup. It then opens the new layout in a hidden chart page and counts what
TradingView itself shows (`getAllShapes`, `getAllStudies`). The restore only
counts as verified when TradingView shows every drawing. If the chart page
can't be checked, the result says so.

## Saved-layout limits

Free: 1 layout. Essential: 5. Plus: 10. Premium and Ultimate: unlimited.
Before a restore, ChartKeeper reads `/api/v1/charts/count/` and the plan from
`window.user`. If no slot is free, it stops and explains that the user must delete or
"Replace" a layout, or upgrade. If the server still refuses the save with the
limit error, the same message appears.

## Open risks

These were derived from source code, not observed with a real account:

1. The exact field names in `/my-charts/` list entries. The parser accepts
   several known spellings and fails loudly if it cannot find a layout id.
2. The exact shape of a stored drawing `dto.state`. The parser accepts both a
   full drawing source (`{type, points, state}`) and a bare properties object
   with the type alongside it, and reports anything else as an error.
3. Whether the save endpoint requires the symbol fields. ChartKeeper sends
   them, built from the backed-up list entry or the main series.
4. Google sign-in in a Chrome window started by another program. ChartKeeper
   starts the user's own Chrome without automation flags. If Google still
   refuses, signing in with email and password works.

`npm run test:live` (see README) checks 1 to 3 against a test account.
