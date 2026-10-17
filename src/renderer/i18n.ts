import type { BackupStep } from '../core/backup';
import type { RestoreStep } from '../core/restore';
import type { AppError, Lang } from '../shared/api';

const en = {
  'app.tagline': 'Keeps a safe copy of your TradingView charts on this computer.',
  'nav.home': 'Back to start',
  'common.loading': 'One moment…',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.tryAgain': 'Try again',
  'common.openFolder': 'Open folder',

  'signin.signedInAs': 'Signed in to TradingView as {name}',
  'signin.signedIn': 'Signed in to TradingView',
  'signin.signOut': 'Sign out',
  'signin.notSignedIn': 'Not signed in to TradingView',
  'signin.button': 'Sign in to TradingView',
  'signin.explain': 'A browser window opens where you sign in to TradingView yourself, the way you usually do. Google sign-in and two-step codes work there. ChartKeeper never sees or stores your password.',
  'signin.browser': 'The window opens in {browser}.',
  'signin.waitingTitle': 'Waiting for you to sign in…',
  'signin.waitingBody': 'Sign in in the browser window that just opened. This window updates by itself when you are done.',

  'home.backup': 'Back up now',
  'home.view': 'View my backups',
  'home.restore': 'Restore a chart',
  'home.needSignIn': 'Sign in to TradingView first to back up or restore. You can look at your backups without signing in.',
  'home.lastBackup': 'Last backup: {when}, {layouts}.',
  'home.lastBackupNoCount': 'Last backup: {when}.',
  'home.lastBackupFailed': 'The last backup ({when}) did not finish. Press “Back up now” to try again.',
  'home.noBackupYet': 'You have not made a backup yet.',
  'home.busyBackup': 'A backup is running right now.',
  'home.busyRestore': 'A chart is being restored right now.',

  'settings.title': 'Settings',
  'settings.folder': 'Your backups are saved in this folder',
  'settings.change': 'Change…',
  'settings.daily': 'Back up automatically every day',
  'settings.dailyHour': 'At what time',
  'settings.dailyNote': 'ChartKeeper keeps running in the background after you close the window, so the backup can happen on time. Look for its small icon next to the clock. The computer must be switched on.',
  'settings.prices': 'Also save prices so charts can be viewed offline',
  'settings.pricesNote': 'For your personal use only. The prices belong to TradingView and its data providers.',
  'settings.language': 'Language',

  'count.layouts_one': '{n} layout',
  'count.layouts_other': '{n} layouts',
  'count.drawings_one': '{n} drawing',
  'count.drawings_other': '{n} drawings',
  'count.indicators_one': '{n} indicator',
  'count.indicators_other': '{n} indicators',
  'count.notes_one': '{n} note',
  'count.notes_other': '{n} notes',

  'backupStep.list': 'Getting the list of your layouts from TradingView…',
  'backupStep.layout': 'Saving the layout “{name}”…',
  'backupStep.userDrawings': 'Saving drawings that are shared between your layouts…',
  'backupStep.studyTemplates': 'Saving your indicator templates…',
  'backupStep.drawingTemplates': 'Saving your drawing templates and colour themes…',
  'backupStep.scripts': 'Saving your Pine scripts…',
  'backupStep.prices': 'Saving prices for “{name}” so you can view it offline…',
  'backupStep.finish': 'Finishing the backup…',

  'backup.title': 'Backup',
  'backup.running': 'Making a backup…',
  'backup.runningNote': 'This usually takes a few minutes. You can leave the window open and do something else in the meantime.',
  'backup.starting': 'Starting…',
  'backup.done': 'Backup complete',
  'backup.doneSummary': '{layouts} and {drawings} are saved on this computer.',
  'backup.viewIt': 'View it',
  'backup.notesIntro': 'Technical notes from the backup. The backup is still complete.',
  'backup.failed': 'The backup could not be completed',
  'backup.failedPartial': 'What was saved before the problem is marked as incomplete, so you will not mistake it for a full backup.',

  'view.title': 'My backups',
  'view.backups': 'Backups',
  'view.empty': 'There are no backups yet. Go back and press “Back up now”.',
  'view.incomplete': 'Incomplete',
  'view.incompleteNote': 'This backup did not finish. Do not rely on it.',
  'view.unreadable': 'This backup could not be read.',
  'view.safetyCopy': 'Safety copy before a replace',
  'view.layouts': 'Layouts in this backup',
  'view.noLayouts': 'This backup has no layouts.',
  'view.noPrices': 'No offline prices',
  'view.compareLabel': 'Compare with an older backup',
  'view.compareButton': 'Compare',
  'view.compareNoOlder': 'There is no older backup to compare with.',
  'view.compareTitle': 'Changes from {older} to {newer}',
  'view.compareNone': 'Nothing changed between these two backups.',
  'view.compareUnchanged': 'Unchanged: {names}',
  'view.compareOther': 'Templates, themes and scripts',
  'view.compareClose': 'Back to the chart',
  'view.pickLayout': 'Choose a layout above to see it.',

  'change.added': 'Added',
  'change.removed': 'Removed',
  'change.changed': 'Changed',
  'layoutStatus.added': 'New layout',
  'layoutStatus.removed': 'Layout deleted',
  'layoutStatus.changed': 'Changed',
  'layoutStatus.same': 'No changes',

  'restore.title': 'Restore a chart',
  'restore.stepOf': 'Step {n} of 3',
  'restore.step1': 'Choose the chart',
  'restore.step2': 'Choose how',
  'restore.step3': 'Restore',
  'restore.chooseTitle': 'Which chart do you want back?',
  'restore.chooseBackup': 'Choose a backup',
  'restore.chooseLayout': 'Choose the layout',
  'restore.noBackups': 'There are no backups to restore from yet.',
  'restore.howTitle': 'How should it be restored?',
  'restore.restoring': 'You are restoring “{name}” from the backup taken {when}.',
  'restore.checking': 'Checking your TradingView account…',
  'restore.modeNew': 'As a new layout',
  'restore.recommended': 'Recommended',
  'restore.modeNewNote': 'Nothing on TradingView is changed or deleted. The chart is added next to your other layouts.',
  'restore.modeReplace': 'Replace one of my layouts',
  'restore.modeReplaceNote': 'The layout you choose is overwritten with the backup. ChartKeeper saves a safety copy of it first.',
  'restore.slots': 'You have {used} of {limit} saved layouts on TradingView.',
  'restore.slotsUnlimited': 'You have {used} saved layouts on TradingView.',
  'restore.fullTitle': 'There is no room for a new layout',
  'restore.fullBody': 'Your TradingView plan ({plan}) allows {limit} saved layouts, and they are all in use.',
  'restore.fullBodyNoPlan': 'Your TradingView plan allows {limit} saved layouts, and they are all in use.',
  'restore.fullWhat': 'What you can do:',
  'restore.fullDelete': 'Delete a layout you no longer use on TradingView, then come back here.',
  'restore.fullUpgrade': 'Upgrade your TradingView plan to get room for more layouts.',
  'restore.fullReplace': 'Or choose “Replace one of my layouts” above.',
  'restore.target': 'Which of your layouts on TradingView should be replaced?',
  'restore.targetPick': 'Choose a layout…',
  'restore.noTargets': 'You have no layouts on TradingView to replace.',
  'restore.typeName': 'To confirm, type the name of that layout:',
  'restore.typeNameLabel': 'Name of the layout to replace',
  'restore.nameMatches': 'The name matches.',
  'restore.nameMismatch': 'The name does not match yet.',
  'restore.start': 'Restore',
  'restore.confirmTitle': 'Replace “{name}”?',
  'restore.confirmBody': 'The layout “{name}” on TradingView will be overwritten with the backup. ChartKeeper saves a safety copy of it first, so it can be brought back.',
  'restore.confirmYes': 'Yes, replace it',
  'restore.running': 'Restoring “{name}”…',
  'restore.runningNote': 'Please wait. This takes about a minute.',
  'restore.done': 'Your layout “{name}” is back on TradingView',
  'restore.checkTitle': 'ChartKeeper checked the result',
  'restore.colWhat': 'What',
  'restore.colBackup': 'In the backup',
  'restore.colSaved': 'Saved on TradingView',
  'restore.colShown': 'Shown on the chart',
  'restore.notChecked': 'Could not check. Open the layout to look.',
  'restore.rowCharts': 'Charts',
  'restore.rowDrawings': 'Drawings',
  'restore.rowIndicators': 'Indicators',
  'restore.open': 'Open on TradingView',
  'restore.missingTitle': 'Not everything came back',
  'restore.missing_one': '{n} drawing from the backup is missing on TradingView.',
  'restore.missing_other': '{n} drawings from the backup are missing on TradingView.',
  'restore.mismatchNote': 'Open the layout on TradingView and look it over. Your backup is untouched, so you can try again.',
  'restore.safety': 'Before replacing it, ChartKeeper saved a safety copy of the layout as it was:',
  'restore.resumed': 'An earlier attempt had already started this restore, so ChartKeeper finished it instead of making a second copy.',
  'restore.another': 'Restore another chart',
  'restore.failed': 'The chart could not be restored',
  'restore.templatesTitle': 'Templates and themes',
  'restore.templatesNote': 'Adds the indicator templates, drawing templates and colour themes from the chosen backup to TradingView. The ones you already have are left alone.',
  'restore.templatesButton': 'Restore my templates and themes',
  'restore.templatesRunning': 'Restoring templates and themes…',
  'restore.templatesAdded': 'Added',
  'restore.templatesSkipped': 'Already there, left alone',
  'restore.templatesNothing': 'There was nothing to restore in this backup.',

  'restoreStep.check': 'Checking your TradingView account…',
  'restoreStep.create': 'Creating the layout on TradingView…',
  'restoreStep.safetyCopy': 'Saving a safety copy of the layout that will be replaced…',
  'restoreStep.replace': 'Replacing the layout on TradingView…',
  'restoreStep.clearDrawings': 'Removing old drawings from the replaced layout…',
  'restoreStep.verify': 'Checking that everything came back…',

  'error.details': 'Details',
  'error.signInAgain': 'Sign in again',
  'error.not-signed-in.title': 'You are not signed in to TradingView',
  'error.not-signed-in.body': 'Your sign-in has run out. Sign in again, then try once more.',
  'error.rate-limited.title': 'TradingView asked ChartKeeper to wait',
  'error.rate-limited.body': 'Too many requests were sent in a short time. Wait an hour, then try again. Nothing is wrong with your account.',
  'error.format-changed.title': 'TradingView has changed something',
  'error.format-changed.body': 'ChartKeeper did not recognise TradingView’s answer and stopped to be safe. Nothing on TradingView was changed. Please check for a new version of ChartKeeper.',
  'error.limit-reached.title': 'There is no room for another layout',
  'error.limit-reached.body': 'Your TradingView plan ({plan}) allows {limit} saved layouts, and they are all in use. Delete a layout on TradingView, upgrade your plan, or choose “Replace one of my layouts”.',
  'error.limit-reached.bodyGeneric': 'Your TradingView plan has no room for more saved layouts. Delete a layout on TradingView, upgrade your plan, or choose “Replace one of my layouts”.',
  'error.too-large.title': 'The layout is too large',
  'error.too-large.body': 'TradingView will not accept a layout this large. Nothing was changed.',
  'error.not-found.title': 'The layout could not be found',
  'error.not-found.body': 'TradingView could not find it. It may have been deleted in the meantime.',
  'error.network.title': 'No connection to the internet',
  'error.network.body': 'Check that the computer is connected to the internet, then try again.',
  'error.server.title': 'TradingView is having problems right now',
  'error.server.body': 'This is on TradingView’s side. Try again a little later.',
  'error.cancelled.title': 'Stopped',
  'error.cancelled.body': 'The task was stopped before it finished.',
  'error.unexpected.title': 'Something went wrong',
  'error.unexpected.body': 'ChartKeeper ran into an unexpected problem. Try again. If it keeps happening, send the details below to the person who helps you.',
  'error.busy.title': 'ChartKeeper is busy',
  'error.busy.body': 'Another task is running. Wait until it has finished, then try again.',
  'error.browser.title': 'The browser could not be opened',
  'error.browser.body': 'ChartKeeper could not open a window for signing in. Try again. If it keeps happening, restart the computer.',
} as const;

export type Key = keyof typeof en;

const da: { [K in Key]: string } = {
  'app.tagline': 'Gemmer en sikker kopi af dine TradingView-grafer på denne computer.',
  'nav.home': 'Tilbage til forsiden',
  'common.loading': 'Et øjeblik…',
  'common.next': 'Næste',
  'common.back': 'Tilbage',
  'common.cancel': 'Fortryd',
  'common.tryAgain': 'Prøv igen',
  'common.openFolder': 'Åbn mappen',

  'signin.signedInAs': 'Logget ind på TradingView som {name}',
  'signin.signedIn': 'Logget ind på TradingView',
  'signin.signOut': 'Log ud',
  'signin.notSignedIn': 'Ikke logget ind på TradingView',
  'signin.button': 'Log ind på TradingView',
  'signin.explain': 'Der åbner et browservindue, hvor du selv logger ind på TradingView, ligesom du plejer. Du kan bruge Google-login og engangskoder. ChartKeeper ser aldrig din adgangskode og gemmer den ikke.',
  'signin.browser': 'Vinduet åbner i {browser}.',
  'signin.waitingTitle': 'Venter på, at du logger ind…',
  'signin.waitingBody': 'Log ind i det browservindue, der lige er åbnet. Dette vindue opdaterer sig selv, når du er færdig.',

  'home.backup': 'Tag backup nu',
  'home.view': 'Se mine backups',
  'home.restore': 'Gendan en graf',
  'home.needSignIn': 'Log ind på TradingView først for at tage backup eller gendanne. Du kan godt se dine backups uden at logge ind.',
  'home.lastBackup': 'Seneste backup: {when}, {layouts}.',
  'home.lastBackupNoCount': 'Seneste backup: {when}.',
  'home.lastBackupFailed': 'Den seneste backup ({when}) blev ikke færdig. Tryk på »Tag backup nu« for at prøve igen.',
  'home.noBackupYet': 'Du har ikke taget en backup endnu.',
  'home.busyBackup': 'Der bliver taget backup lige nu.',
  'home.busyRestore': 'Der bliver gendannet en graf lige nu.',

  'settings.title': 'Indstillinger',
  'settings.folder': 'Dine backups gemmes i denne mappe',
  'settings.change': 'Skift…',
  'settings.daily': 'Tag automatisk backup hver dag',
  'settings.dailyHour': 'Hvornår på dagen',
  'settings.dailyNote': 'ChartKeeper bliver ved med at køre i baggrunden, når du lukker vinduet, så backuppen kan blive taget til tiden. Se efter det lille ikon ved uret. Computeren skal være tændt.',
  'settings.prices': 'Gem også kurser, så graferne kan ses uden internet',
  'settings.pricesNote': 'Kun til dit eget personlige brug. Kurserne tilhører TradingView og deres dataleverandører.',
  'settings.language': 'Sprog',

  'count.layouts_one': '{n} layout',
  'count.layouts_other': '{n} layouts',
  'count.drawings_one': '{n} tegning',
  'count.drawings_other': '{n} tegninger',
  'count.indicators_one': '{n} indikator',
  'count.indicators_other': '{n} indikatorer',
  'count.notes_one': '{n} bemærkning',
  'count.notes_other': '{n} bemærkninger',

  'backupStep.list': 'Henter listen over dine layouts fra TradingView…',
  'backupStep.layout': 'Gemmer layoutet »{name}«…',
  'backupStep.userDrawings': 'Gemmer de tegninger, der deles mellem dine layouts…',
  'backupStep.studyTemplates': 'Gemmer dine indikatorskabeloner…',
  'backupStep.drawingTemplates': 'Gemmer dine tegneskabeloner og farvetemaer…',
  'backupStep.scripts': 'Gemmer dine Pine-scripts…',
  'backupStep.prices': 'Gemmer kurser for »{name}«, så du kan se den uden internet…',
  'backupStep.finish': 'Gør backuppen færdig…',

  'backup.title': 'Backup',
  'backup.running': 'Tager backup…',
  'backup.runningNote': 'Det tager som regel et par minutter. Du kan lade vinduet stå åbent og lave noget andet imens.',
  'backup.starting': 'Starter…',
  'backup.done': 'Backuppen er færdig',
  'backup.doneSummary': '{layouts} og {drawings} er gemt på denne computer.',
  'backup.viewIt': 'Se den',
  'backup.notesIntro': 'Tekniske bemærkninger fra backuppen. Backuppen er stadig hel.',
  'backup.failed': 'Backuppen kunne ikke gøres færdig',
  'backup.failedPartial': 'Det, der nåede at blive gemt, er markeret som ufuldstændigt, så du ikke forveksler det med en hel backup.',

  'view.title': 'Mine backups',
  'view.backups': 'Backups',
  'view.empty': 'Der er ingen backups endnu. Gå tilbage, og tryk på »Tag backup nu«.',
  'view.incomplete': 'Ufuldstændig',
  'view.incompleteNote': 'Denne backup blev ikke færdig. Regn ikke med den.',
  'view.unreadable': 'Denne backup kunne ikke læses.',
  'view.safetyCopy': 'Sikkerhedskopi fra før en erstatning',
  'view.layouts': 'Layouts i denne backup',
  'view.noLayouts': 'Denne backup har ingen layouts.',
  'view.noPrices': 'Uden gemte kurser',
  'view.compareLabel': 'Sammenlign med en ældre backup',
  'view.compareButton': 'Sammenlign',
  'view.compareNoOlder': 'Der er ingen ældre backup at sammenligne med.',
  'view.compareTitle': 'Ændringer fra {older} til {newer}',
  'view.compareNone': 'Intet er ændret mellem de to backups.',
  'view.compareUnchanged': 'Uændret: {names}',
  'view.compareOther': 'Skabeloner, temaer og scripts',
  'view.compareClose': 'Tilbage til grafen',
  'view.pickLayout': 'Vælg et layout ovenfor for at se det.',

  'change.added': 'Tilføjet',
  'change.removed': 'Fjernet',
  'change.changed': 'Ændret',
  'layoutStatus.added': 'Nyt layout',
  'layoutStatus.removed': 'Layout slettet',
  'layoutStatus.changed': 'Ændret',
  'layoutStatus.same': 'Ingen ændringer',

  'restore.title': 'Gendan en graf',
  'restore.stepOf': 'Trin {n} af 3',
  'restore.step1': 'Vælg grafen',
  'restore.step2': 'Vælg hvordan',
  'restore.step3': 'Gendan',
  'restore.chooseTitle': 'Hvilken graf vil du have tilbage?',
  'restore.chooseBackup': 'Vælg en backup',
  'restore.chooseLayout': 'Vælg layoutet',
  'restore.noBackups': 'Der er ingen backups at gendanne fra endnu.',
  'restore.howTitle': 'Hvordan skal den gendannes?',
  'restore.restoring': 'Du gendanner »{name}« fra backuppen taget {when}.',
  'restore.checking': 'Tjekker din TradingView-konto…',
  'restore.modeNew': 'Som et nyt layout',
  'restore.recommended': 'Anbefalet',
  'restore.modeNewNote': 'Intet på TradingView bliver ændret eller slettet. Grafen bliver lagt ind ved siden af dine andre layouts.',
  'restore.modeReplace': 'Erstat et af mine layouts',
  'restore.modeReplaceNote': 'Det layout, du vælger, bliver overskrevet med backuppen. ChartKeeper gemmer først en sikkerhedskopi af det.',
  'restore.slots': 'Du har {used} af {limit} gemte layouts på TradingView.',
  'restore.slotsUnlimited': 'Du har {used} gemte layouts på TradingView.',
  'restore.fullTitle': 'Der er ikke plads til et nyt layout',
  'restore.fullBody': 'Dit TradingView-abonnement ({plan}) giver plads til {limit} gemte layouts, og de er alle i brug.',
  'restore.fullBodyNoPlan': 'Dit TradingView-abonnement giver plads til {limit} gemte layouts, og de er alle i brug.',
  'restore.fullWhat': 'Det kan du gøre:',
  'restore.fullDelete': 'Slet et layout, du ikke bruger mere, på TradingView, og kom så tilbage hertil.',
  'restore.fullUpgrade': 'Opgrader dit TradingView-abonnement, så du får plads til flere layouts.',
  'restore.fullReplace': 'Eller vælg »Erstat et af mine layouts« ovenfor.',
  'restore.target': 'Hvilket af dine layouts på TradingView skal erstattes?',
  'restore.targetPick': 'Vælg et layout…',
  'restore.noTargets': 'Du har ingen layouts på TradingView, der kan erstattes.',
  'restore.typeName': 'Skriv navnet på layoutet for at bekræfte:',
  'restore.typeNameLabel': 'Navnet på det layout, der skal erstattes',
  'restore.nameMatches': 'Navnet passer.',
  'restore.nameMismatch': 'Navnet passer ikke endnu.',
  'restore.start': 'Gendan',
  'restore.confirmTitle': 'Erstat »{name}«?',
  'restore.confirmBody': 'Layoutet »{name}« på TradingView bliver overskrevet med backuppen. ChartKeeper gemmer først en sikkerhedskopi af det, så det kan hentes tilbage.',
  'restore.confirmYes': 'Ja, erstat det',
  'restore.running': 'Gendanner »{name}«…',
  'restore.runningNote': 'Vent venligst. Det tager omkring et minut.',
  'restore.done': 'Dit layout »{name}« er tilbage på TradingView',
  'restore.checkTitle': 'ChartKeeper har tjekket resultatet',
  'restore.colWhat': 'Hvad',
  'restore.colBackup': 'I backuppen',
  'restore.colSaved': 'Gemt på TradingView',
  'restore.colShown': 'Vist på grafen',
  'restore.notChecked': 'Kunne ikke tjekkes. Åbn layoutet og se efter.',
  'restore.rowCharts': 'Grafer',
  'restore.rowDrawings': 'Tegninger',
  'restore.rowIndicators': 'Indikatorer',
  'restore.open': 'Åbn på TradingView',
  'restore.missingTitle': 'Ikke alt kom med',
  'restore.missing_one': '{n} tegning fra backuppen mangler på TradingView.',
  'restore.missing_other': '{n} tegninger fra backuppen mangler på TradingView.',
  'restore.mismatchNote': 'Åbn layoutet på TradingView, og se det efter. Din backup er urørt, så du kan prøve igen.',
  'restore.safety': 'Før layoutet blev erstattet, gemte ChartKeeper en sikkerhedskopi af det, som det var:',
  'restore.resumed': 'Et tidligere forsøg var allerede gået i gang med denne gendannelse, så ChartKeeper gjorde det færdigt i stedet for at lave en kopi mere.',
  'restore.another': 'Gendan en graf mere',
  'restore.failed': 'Grafen kunne ikke gendannes',
  'restore.templatesTitle': 'Skabeloner og temaer',
  'restore.templatesNote': 'Lægger indikatorskabeloner, tegneskabeloner og farvetemaer fra den valgte backup ind på TradingView. Dem, du allerede har, bliver ikke rørt.',
  'restore.templatesButton': 'Gendan mine skabeloner og temaer',
  'restore.templatesRunning': 'Gendanner skabeloner og temaer…',
  'restore.templatesAdded': 'Tilføjet',
  'restore.templatesSkipped': 'Fandtes allerede, ikke rørt',
  'restore.templatesNothing': 'Der var ikke noget at gendanne i denne backup.',

  'restoreStep.check': 'Tjekker din TradingView-konto…',
  'restoreStep.create': 'Opretter layoutet på TradingView…',
  'restoreStep.safetyCopy': 'Gemmer en sikkerhedskopi af det layout, der bliver erstattet…',
  'restoreStep.replace': 'Erstatter layoutet på TradingView…',
  'restoreStep.clearDrawings': 'Fjerner gamle tegninger fra det erstattede layout…',
  'restoreStep.verify': 'Tjekker, at alt kom med…',

  'error.details': 'Detaljer',
  'error.signInAgain': 'Log ind igen',
  'error.not-signed-in.title': 'Du er ikke logget ind på TradingView',
  'error.not-signed-in.body': 'Dit login er udløbet. Log ind igen, og prøv så en gang til.',
  'error.rate-limited.title': 'TradingView har bedt ChartKeeper om at vente',
  'error.rate-limited.body': 'Der blev sendt for mange forespørgsler på kort tid. Vent en time, og prøv så igen. Der er ikke noget galt med din konto.',
  'error.format-changed.title': 'TradingView har ændret noget',
  'error.format-changed.body': 'ChartKeeper genkendte ikke svaret fra TradingView og stoppede for en sikkerheds skyld. Intet på TradingView blev ændret. Se efter, om der er kommet en ny version af ChartKeeper.',
  'error.limit-reached.title': 'Der er ikke plads til flere layouts',
  'error.limit-reached.body': 'Dit TradingView-abonnement ({plan}) giver plads til {limit} gemte layouts, og de er alle i brug. Slet et layout på TradingView, opgrader dit abonnement, eller vælg »Erstat et af mine layouts«.',
  'error.limit-reached.bodyGeneric': 'Dit TradingView-abonnement har ikke plads til flere gemte layouts. Slet et layout på TradingView, opgrader dit abonnement, eller vælg »Erstat et af mine layouts«.',
  'error.too-large.title': 'Layoutet er for stort',
  'error.too-large.body': 'TradingView vil ikke tage imod et så stort layout. Intet blev ændret.',
  'error.not-found.title': 'Layoutet kunne ikke findes',
  'error.not-found.body': 'TradingView kunne ikke finde det. Måske er det blevet slettet i mellemtiden.',
  'error.network.title': 'Ingen forbindelse til internettet',
  'error.network.body': 'Tjek, at computeren er på internettet, og prøv så igen.',
  'error.server.title': 'TradingView har problemer lige nu',
  'error.server.body': 'Fejlen er hos TradingView. Prøv igen lidt senere.',
  'error.cancelled.title': 'Afbrudt',
  'error.cancelled.body': 'Opgaven blev stoppet, før den var færdig.',
  'error.unexpected.title': 'Noget gik galt',
  'error.unexpected.body': 'ChartKeeper løb ind i et uventet problem. Prøv igen. Hvis det bliver ved, så send detaljerne herunder til den, der hjælper dig.',
  'error.busy.title': 'ChartKeeper er optaget',
  'error.busy.body': 'En anden opgave er i gang. Vent, til den er færdig, og prøv så igen.',
  'error.browser.title': 'Browseren kunne ikke åbnes',
  'error.browser.body': 'ChartKeeper kunne ikke åbne et vindue til at logge ind. Prøv igen. Hvis det bliver ved, så genstart computeren.',
};

export const DICTIONARIES: Record<Lang, { [K in Key]: string }> = { en, da };

type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | ParamNames<Rest> : never;
export type Params<K extends Key> = Record<ParamNames<(typeof en)[K]>, string | number>;
type ParamArgs<K extends Key> = [ParamNames<(typeof en)[K]>] extends [never] ? [] : [params: Params<K>];

let current: Lang = 'da';
export const setLang = (lang: Lang) => {
  current = lang;
};
export const getLang = (): Lang => current;

export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      console.error(`i18n: missing param {${name}} in "${template}"`);
      return '';
    }
    return String(value);
  });
}

export function t<K extends Key>(key: K, ...args: ParamArgs<K>): string {
  return fill(DICTIONARIES[current][key], args[0]);
}

type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];
export function tn(base: PluralBase, n: number): string {
  const key = `${base}_${n === 1 ? 'one' : 'other'}` as Key;
  return fill(DICTIONARIES[current][key], { n: n.toLocaleString(locale()) });
}

/** Every kind of failure the window explains, and where its words live. */
export const ERROR_KEYS = {
  'not-signed-in': ['error.not-signed-in.title', 'error.not-signed-in.body'],
  'rate-limited': ['error.rate-limited.title', 'error.rate-limited.body'],
  'format-changed': ['error.format-changed.title', 'error.format-changed.body'],
  'limit-reached': ['error.limit-reached.title', 'error.limit-reached.body'],
  'too-large': ['error.too-large.title', 'error.too-large.body'],
  'not-found': ['error.not-found.title', 'error.not-found.body'],
  network: ['error.network.title', 'error.network.body'],
  server: ['error.server.title', 'error.server.body'],
  cancelled: ['error.cancelled.title', 'error.cancelled.body'],
  unexpected: ['error.unexpected.title', 'error.unexpected.body'],
  busy: ['error.busy.title', 'error.busy.body'],
  browser: ['error.browser.title', 'error.browser.body'],
} as const satisfies Record<AppError['kind'], readonly [Key, Key]>;

export const BACKUP_STEP_KEYS = {
  list: 'backupStep.list',
  layout: 'backupStep.layout',
  userDrawings: 'backupStep.userDrawings',
  studyTemplates: 'backupStep.studyTemplates',
  drawingTemplates: 'backupStep.drawingTemplates',
  scripts: 'backupStep.scripts',
  prices: 'backupStep.prices',
  finish: 'backupStep.finish',
} as const satisfies Record<BackupStep, Key>;

export const RESTORE_STEP_KEYS = {
  check: 'restoreStep.check',
  create: 'restoreStep.create',
  safetyCopy: 'restoreStep.safetyCopy',
  replace: 'restoreStep.replace',
  clearDrawings: 'restoreStep.clearDrawings',
  verify: 'restoreStep.verify',
} as const satisfies Record<RestoreStep, Key>;

export function explainError(error: AppError): { title: string; body: string } {
  const [titleKey, bodyKey] = ERROR_KEYS[error.kind] ?? ERROR_KEYS.unexpected;
  const dict = DICTIONARIES[current];
  if (error.kind === 'limit-reached' && error.params.limit === undefined) return { title: dict[titleKey], body: dict['error.limit-reached.bodyGeneric'] };
  const params = error.kind === 'limit-reached' ? { plan: error.params.plan ?? '', ...error.params } : error.params;
  return { title: dict[titleKey], body: fill(dict[bodyKey], params) };
}

export function backupStepText(step: BackupStep, name: string | undefined): string {
  return fill(DICTIONARIES[current][BACKUP_STEP_KEYS[step]], { name: name ?? '' });
}

export function restoreStepText(step: RestoreStep): string {
  return DICTIONARIES[current][RESTORE_STEP_KEYS[step]];
}

const locale = () => (current === 'da' ? 'da-DK' : 'en-GB');

export function formatTime(d: Date): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** "fredag den 17. oktober 2026" / "Friday 17 October 2026" */
export function formatDay(d: Date): string {
  const s = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

export function formatHour(hour: number): string {
  return formatTime(new Date(2000, 0, 1, hour, 0));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today at 09:12", "yesterday at 18:30", "3 days ago", then the plain date. */
export function formatRelative(d: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const da = current === 'da';
  if (days === 0) return da ? `i dag kl. ${formatTime(d)}` : `today at ${formatTime(d)}`;
  if (days === 1) return da ? `i går kl. ${formatTime(d)}` : `yesterday at ${formatTime(d)}`;
  if (days > 1 && days < 7) return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-days, 'day');
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
