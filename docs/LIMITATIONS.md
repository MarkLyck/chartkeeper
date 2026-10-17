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

The viewer marks each of these in a "Not shown" panel next to the chart, with
the reason. Nothing is hidden silently.

| Item | Why |
| --- | --- |
| Labels, boxes, lines and tables that Pine scripts draw (`label.new`, `box.new`, `table.new`) | ChartKeeper saves the values of every plotted line of an indicator, including your own Pine indicators, because TradingView's servers calculate them during the backup. The extra graphics a script draws are stored in the backup but not drawn. |
| Indicators TradingView refused to calculate during the backup | For example when the plan's limit on indicators per chart was reached, or a script was removed. The backup still holds the indicator and its settings; only its values are missing. |
| Rare drawing tools (Gann, Elliott waves, pitchforks, patterns, emoji/icons, images, tables) | They are in the backup and restored exactly. The viewer lists the ones it can't draw. |
| Charts whose prices could not be fetched (a delisted symbol, or "save prices" switched off) | The layout and drawings are still backed up; the viewer explains that there are no prices. |
| Exact pixel styling | The viewer uses TradingView's open-source Lightweight Charts library, not TradingView's own chart engine, so fonts, label placement and some line styles differ slightly. |

## Restore limits

| Item | Why |
| --- | --- |
| Free layout slot | Restoring as a new layout needs a free slot in your plan (Free 1, Essential 5, Plus 10, Premium/Ultimate unlimited). ChartKeeper checks first and explains what to do. |
| Pine script source | Your own scripts are backed up as `.pine` files you can open in any text editor. To put one back, open TradingView's Pine Editor, paste it, and save. Layouts that use your scripts work as long as the script still exists in your account. |
| Templates and themes | "Restore my templates and themes" adds the ones you don't have. It never changes or deletes existing ones. |
| Alerts | See above. |

## Data and terms of use

TradingView's terms license market data for display to you, for personal use
only. ChartKeeper saves prices only so you can look at your own charts offline.
Keep the backups for yourself. Don't share or publish them. You can switch off
"Also save prices" in the settings.
