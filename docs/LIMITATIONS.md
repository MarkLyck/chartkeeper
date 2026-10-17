# What ChartKeeper does not back up or show

## Not backed up

| Item | Why |
| --- | --- |
| Alerts | Alerts live in a separate TradingView service and are tied to live prices and notification settings. Restoring them automatically could fire real alerts, so ChartKeeper leaves them alone. Their drawings (if an alert is attached to a trend line) are backed up as drawings. |
| Watchlists | Not part of a chart layout. A later version could add them (`/api/v1/symbols_list/`). |
| Published ideas, scripts by other people, and invite-only scripts | They belong to their authors. Layouts that use them are backed up, but the script source is not. |
| Paper trading and broker data (orders, positions) | Account data at the broker, not chart data. |
| Chart replay state and "bar replay" sessions | Temporary by nature. |
| Your password, two-step codes, or payment details | ChartKeeper never asks for or stores them. It keeps only the sign-in cookie, in a private folder. |

## Backed up, but not shown in the offline viewer

The viewer draws every drawing tool, chart style and indicator that a
signed-out TradingView chart offers: 89 drawing tools, 18 chart styles and the
9 built-in indicators, including pivot points. `npm run gallery:compare` checks
each one against TradingView's own rendering of the same layout (see
`test/fixtures/gallery/`).

The viewer marks everything below in a "Not shown" panel next to the chart,
with the reason. Nothing is hidden silently. Items drawn with a difference are
listed as "partly" shown.

| Item | Why |
| --- | --- |
| Labels, boxes, lines and tables that Pine scripts draw (`label.new`, `box.new`, `table.new`) | ChartKeeper saves the values of every plotted line of an indicator, including your own Pine indicators, because TradingView's servers calculate them during the backup. The extra graphics a script draws are stored in the backup but not drawn. Pivot points, which TradingView draws the same way, are drawn. |
| Indicators TradingView refused to calculate during the backup | For example when the plan's limit on indicators per chart was reached, or a script was removed. The backup still holds the indicator and its settings; only its values are missing. |
| Image drawings | The picture lives on TradingView's servers, not in the layout, so the viewer can't show it offline. The drawing is backed up and restored. |
| Emoji and stickers (partly) | Emoji are drawn with your computer's emoji font, so they look like your system's emoji, not TradingView's. Stickers are pictures TradingView serves; the viewer draws a simple stand-in. Icons are exact: TradingView draws them with Font Awesome 4.7, which ChartKeeper includes. |
| Fixed range volume profile in older backups (partly) | TradingView calculates the profile on its servers from finer bars than the chart's. Backups made with this version store TradingView's own profile; for older backups the viewer calculates it from the chart's bars, which can differ slightly. Anchored VWAP is the same calculation either way. |
| Renko, Kagi, Point & Figure, Line Break and Range charts in older backups | TradingView builds these bars on its servers. Backups made with this version store them and the viewer draws them as TradingView does. Older backups have only the plain bars, so the viewer shows candles and says so. Heikin Ashi is calculated locally for older backups. |
| Paid chart styles (Volume Footprint, Time Price Opportunity, Volume Candles, Session Volume Profile) | They need data from a paid plan that a backup doesn't fetch. The viewer shows candles and says so. |
| Charts whose prices could not be fetched (a delisted symbol, or "save prices" switched off) | The layout and drawings are still backed up; the viewer explains that there are no prices. |
| Exact pixel styling | The viewer uses TradingView's open-source Lightweight Charts library, not TradingView's own chart engine. Text uses your computer's fonts, and a few axis labels and time-axis ticks are placed slightly differently. |

## Restore limits

| Item | Why |
| --- | --- |
| Free layout slot | Restoring as a new layout needs a free slot in your plan (Free 1, Essential 5, Plus 10, Premium/Ultimate unlimited). ChartKeeper checks first and explains what to do. |
| Pine script source | Your own scripts are backed up as `.pine` files you can open in any text editor. To put one back, open TradingView's Pine Editor, paste it, and save. Layouts that use your scripts work as long as the script still exists in your account. |
| Templates and themes | "Restore my templates and themes" adds the ones you don't have. It never changes or deletes existing ones. |
| Alerts | See above. |
| Drawings synced to all layouts | They are backed up (`user-drawings.json`) and shown in the viewer on every chart of their symbol. A restore doesn't add them to the restored layout, because they live in your account, not in one layout, and TradingView still has them unless you deleted them. |

## Data and terms of use

TradingView's terms license market data for display to you, for personal use
only. ChartKeeper saves prices only so you can look at your own charts offline.
Keep the backups for yourself. Don't share or publish them. You can switch off
"Also save prices" in the settings.
