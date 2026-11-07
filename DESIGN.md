---
name: Sunucu Paneli
description: Self-hosted single-server control panel read like an observatory's night chart; one dark sky, one star-amber accent, only what needs the admin lights up.
colors:
  night-ground: "#0b1020"
  night-surface: "#0e1426"
  panel: "#11182b"
  overlay: "#151d33"
  hover: "#18213a"
  hairline: "#1f2a44"
  hairline-soft: "#18213a"
  hairline-strong: "#2c3a5c"
  field-border: "#58678c"
  star-white: "#e8ecf6"
  muted: "#8d98b3"
  subtle: "#7783a0"
  faint: "#7480a0"
  star-amber: "#f0b44c"
  star-amber-hover: "#f6cd80"
  accent-fg: "#0b1020"
  meter: "#c3cbe0"
  healthy-green: "#74c69d"
  info-blue: "#8ab4ff"
  warning: "#f0b44c"
  coral: "#e26a5f"
  coral-solid: "#ad4036"
  coral-solid-hover: "#9a382f"
  ground-dot: "#8d98b31a"
typography:
  page-title:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "32px"
    letterSpacing: "-0.015em"
  page-title-phone:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.015em"
  figure-large:
    fontFamily: "JetBrains Mono Variable, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: "32px"
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\", \"calt\" 0, \"liga\" 0"
  body-large:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  status:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
  label:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  caption:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.14em"
  micro:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.1em"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "\"tnum\", \"calt\" 0, \"liga\" 0"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "3.5": "14px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.star-amber}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    typography: "{typography.body}"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.star-amber-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.muted}"
  button-secondary:
    textColor: "{colors.star-white}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "40px"
  button-danger:
    textColor: "{colors.coral}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "40px"
  button-danger-solid:
    backgroundColor: "{colors.coral-solid}"
    textColor: "{colors.star-white}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "40px"
  button-danger-solid-hover:
    backgroundColor: "{colors.coral-solid-hover}"
  button-ghost:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.star-white}"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "36px"
  button-phone:
    height: "44px"
  input:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.star-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  input-phone:
    height: "44px"
    typography: "{typography.body-large}"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "20px"
  card-phone:
    padding: "16px"
  card-head:
    padding: "12px 20px"
    height: "52px"
    typography: "{typography.caption}"
  chip:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  chip-selected:
    textColor: "{colors.star-amber}"
  badge:
    rounded: "{rounded.sm}"
    padding: "1px 6px"
    typography: "{typography.caption}"
  status:
    typography: "{typography.status}"
  notice:
    rounded: "{rounded.lg}"
    padding: "14px"
  nav-item:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0 10px 0 14px"
    height: "36px"
  nav-item-active:
    textColor: "{colors.star-white}"
  rail:
    backgroundColor: "{colors.panel}"
    width: "248px"
  tab-bar-phone:
    backgroundColor: "{colors.panel}"
    height: "64px"
  dialog:
    backgroundColor: "{colors.night-surface}"
    rounded: "{rounded.xl}"
  toast:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.star-white}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  kbd:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
    typography: "{typography.mono}"
---

# Design System: Sunucu Paneli

## Overview

**Creative North Star: "Gözlemevi yıldız atlası" (the observatory's star atlas)**

The panel is read like an observatory's night chart: one calm dark sky, and only what needs the admin lights up. The ground is a deep blue-black night; panels are a half-step lighter and drawn with 1px hairlines like plates in an atlas. A single warm star amber marks where the admin can act or should look. Health is told in small star dots (filled, hollow, coral, grey) that always carry a word beside them. When everything is fine the screen is almost monochrome; trouble shows up as a hollow amber ring or a coral mark on exactly the row that needs work, with the button to fix it on the same line.

The world refuses both the category's graphite-and-neon dashboard and decorative space imagery. There are no stars, nebulae, glows or gradients drawn for effect; the atlas lives only in structure: tracked uppercase plate captions, a barely visible dotted coordinate field on the page ground, monospaced figures, and few colours. Density is allowed and aligned: one bordered panel with divided rows rather than cards inside cards, tabular figures, tables that stack on the phone.

Depth is tonal, not cast. Shadows exist only on layers that float above the page. Motion is short and ease-out (press, sheet, dialog) with a reduced-motion path for each.

**Key Characteristics:**
- Night ground, panels and hairlines in one cold blue-grey family; star-white text in three steps.
- One warm accent, star amber, for primary action, selection, focus, links and "look here".
- Fixed status-dot vocabulary, always with text: filled green = fine, amber ring = needs a look, coral = urgent, grey ring = no data.
- Hanken Grotesk for UI, JetBrains Mono for figures and ids; 11px tracked uppercase plate captions.
- Layout A: 248px rail with counts and attention dots, status band on Genel Bakış only (no strip on other screens), bottom tab bar on the phone.
- Brand mark "Raf yıldızı": three server shelves, the top shelf's light amber, echoing the status dots.

## Colors

A cold night palette with a single warm star; state colours are muted so that the amber and coral read only where they mean something.

### Primary
- **Star Amber** (night-chart accent): primary buttons, the selected chip/segment/tab, the 2px current-item bar in the rail and tab bar, focus outlines, links, the active nav count, and the "needs a look" ring. Its hover step is **Pale Star** (`star-amber-hover`); text on amber is the night ground (`accent-fg`). Selection tint is amber at 30%; selected-chip and active-nav washes are amber at 7-9%.

### Secondary
- **Cool Info Blue** (`info-blue`): informational notices and the `BİLGİ` level, the second chart series (e.g. upload next to download), and "special" markers such as restricted access or preview (the `special` role resolves to the same blue).

### Tertiary
- **Healthy Green** (`healthy-green`): the filled "fine" dot. The text next to a healthy dot stays star-white; only the mark is green.
- **Muted Coral** (`coral`): urgent and critical: urgent dots, `ACİL` rows, critical figures in the Sunucu card, error notices, outlined danger buttons, the chart's critical threshold.
- **Final Coral** (`coral-solid`, pressed `coral-solid-hover`): the only filled danger fill, reserved for the irreversible last button in a confirm dialog; star-white text on it passes 4.5:1.
- **Meter Grey** (`meter`): neutral fill of usage bars and the first chart series. Usage is not a warning until it crosses a threshold.

### Neutral
- **Night Ground** (`night-ground`): the page and the theme-color/manifest background; also the brand square.
- **Night Surface** (`night-surface`): inputs, segmented controls, dialogs, kbd.
- **Panel** (`panel`): cards, the status band, the rail, the phone header and tab bar.
- **Overlay** (`overlay`): toasts, chart tooltips, the command palette.
- **Hover** (`hover`): hover wash for ghost and icon buttons and status band cells.
- **Hairline** (`hairline`): every card border, card-head divider and rail divider. **Soft Hairline** (`hairline-soft`) separates rows inside a card and is the chart grid. **Strong Hairline** (`hairline-strong`) outlines secondary buttons and neutral badges.
- **Field Border** (`field-border`): input outline; at least 3:1 on both panel and ground.
- **Star White** (`star-white`): primary text. **Muted** (`muted`): secondary text, captions, ghost controls. **Subtle** (`subtle`) and **Faint** (`faint`): tertiary text, column heads, axis labels, idle counts and the "no data" ring; both stay at least 4.5:1 on the panel.
- **Ground Dot** (`ground-dot`, i.e. rgb(141 152 179 / 0.1), muted at 10%): the dots of the coordinate field on the page ground.

Legacy utility names in the code (`zinc-*`, `sky-*`, `violet-*`) are remapped onto these same scales (night, amber, info blue); new code uses the role names.

### Named Rules
**The One Star Rule.** Star amber is the only warm colour that marks action or attention. It never decorates, never fills a large area, and there is at most one amber primary button per view.

**The Dot Speaks With a Word Rule.** Colour never carries meaning alone. Every status mark has a distinct shape (filled dot, hollow ring, spinner, x, pause) and a text label or an accessible name next to it.

**The Calm Healthy Rule.** Fine is quiet: a green dot with star-white text. Only "needs a look" and "urgent" tint their text.

## Typography

**Display Font:** none (no display face; the page title is the UI face at 700)
**Body Font:** Hanken Grotesk Variable (with ui-sans-serif, system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, Cascadia Mono, Consolas), ligatures and contextual alternates off

**Character:** A plain, slightly warm grotesk for everything a person reads, and a mono for everything a machine produces or a gauge shows, like printed coordinates on a chart.

### Hierarchy
The ramp is fixed at these pixel sizes: 10, 11, 12, 13, 14, 15, 16, 22/24, 28. Do not introduce sizes in between.
- **Figure large** (JetBrains Mono 500, 28px / 32px, -0.02em, tabular): the selected metric in the Sunucu card. The only large number on a screen.
- **Page title** (700, 24px / 32px desktop, 22px / 28px phone, -0.015em, balanced wrap): one per page, followed by a 14px muted description or host line.
- **Body large** (16px): phone body and every phone input (prevents iOS zoom), band headline.
- **Title** (600-700, 15px): brand wordmark and card/section titles that are not captions.
- **Body** (400-500, 14px / 20px): UI text, rows, buttons, nav items.
- **Status** (500, 13px / 20px): the status mark label; also summary values in mono at the same size.
- **Label** (500, 12px): form labels, hints, small buttons, card links, footer lines.
- **Caption** (600, 11px / 16px, 0.14em, uppercase, muted): the atlas plate caption. Card heads, band cell titles, metric names, table column heads, badges (0.06em), phone tab labels (no tracking).
- **Micro** (600, 10px, 0.1em, uppercase): subsystem dot labels in the status band (UYG. / DİSK / YEDEK / DNS / ERİŞİM) and compact chart axes.

### Named Rules
**The Plate Caption Rule.** Section and card headings are 11px tracked uppercase captions, never large headings. A caption names a plate; it is not an eyebrow above a hero title.

**The Mono Is for Figures Rule.** JetBrains Mono, always tabular, is used for numbers and machine text: metric values, nav counts, chart axes and tooltips, container/image names, ids, hashes, ports, versions, kbd, logs and the terminal. Sentences and labels are never mono.

**The Turkish Number Rule.** Every number shown to the user is formatted with `toLocaleString("tr-TR")`: comma decimals and dot thousands (`%0,8`, `15,9 GB`, `7,7 GB`), percent sign before the number (`%20`). Dates and times also use the tr-TR locale.

## Layout

**Layout A, "Ray + bant".** On desktop (from 768px) a fixed 248px left rail on the panel colour holds the brand ("Sunucu Paneli" over a small line "tek sunucu · Tailscale" or "· internet"), a search button with its `Ctrl K` kbd, the navigation in groups separated by hairlines, and a footer with a green dot "Panel çalışıyor", the version (mono, 7 chars) and the account with logout. Each nav item is 36px high, carries a mono count on the right and an attention dot (amber ring = look, coral = urgent, green = fine); the current item gets a 7% amber wash and a 2px amber bar on its left edge, and its count turns amber.

The content column has 32px side padding on desktop (24px on small tablets, 16px on the phone), cards stacked with 16-20px gaps.

**Status band.** Genel Bakış opens with the full-width status band: "Sunucu durumu" (caption, headline, subsystem dots) plus four cells Erişim, İki adımlı giriş, Son yedek, Sunucu dışı kopya, each a caption over a status line. Other screens have no strip or bar above the content: by user decision, protection status lives on Genel Bakış only (and in the rail's attention dots).

**Genel Bakış order**, top to bottom:
1. Status band.
2. "Seni bekleyenler", full width: level label (ACİL / BAKILMALI / BİLGİ) in a 104px column, sentence plus detail line, one action button per row.
3. One row on a six-column grid from 1024px: "En çok kaynak kullananlar" at 4/6 (top five containers, sortable, CPU mini bar with mono value, memory, network; a Docker line in the card footer) and the "Sunucu" card at 2/6 (four-cell summary CPU / Bellek / Disk / Ağ, metric tabs, the selected figure large with its bar, range chips 1 saat / 6 saat / 24 saat / 7 gün, one chart, then En düşük / Ortalama / Tepe).
4. "Tahmin", full width, one row of four cells from 1280px (two by two below): disk fill estimate with its trend, next backup, nearest SSL expiry, pending panel update.
5. "Projeler" table.

**Phone (below 768px).** A 56px sticky header with the brand and a search button replaces the rail; a 64px fixed bottom tab bar holds Genel / Projeler / Veritabanı / Deploylar / Diğer with attention dots, an amber 2px bar above the current tab and an amber icon; "Diğer" opens a bottom sheet with the remaining sections. The band becomes a two-column grid, every row stacks, tables collapse to stacked rows, and the Sunucu card moves above "En çok kaynak kullananlar" on purpose (the server is checked first). Content keeps bottom padding for the tab bar and safe areas.

**Touch targets.** Every interactive control is at least 44px high on the phone (buttons, icon buttons, chips, card links, check rows, status band cells, inputs) and may shrink to 32-40px from 768px.

**Ground.** The page ground only carries the dotted coordinate field: 1px dots of `ground-dot` on a 24px grid, offset 12px. Cards, rail and bars are solid panel colour and hide it.

**Scrollbars.** Thin everywhere, including inner scroll areas: transparent track, thumb on the strong hairline colour, one step lighter on hover; a 10px rounded WebKit fallback with the same colours. Tab rows scroll without a visible bar.

## Elevation & Depth

The system is flat and tonal. Depth comes from the step between night ground, surface and panel, and from 1px hairlines; at rest nothing casts a shadow. Translucent sticky chrome (phone header, phone tab bar) uses the panel colour at 95% with a backdrop blur so content does not show through sharply; that blur is functional, not decorative.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 1px 0 0 rgb(232 236 246 / 0.04) inset, 0 12px 32px -8px rgb(2 4 10 / 0.7), 0 2px 6px -2px rgb(2 4 10 / 0.5)`): floating layers only: dialogs and the confirm window, the command palette, toasts, chart tooltips.

### Named Rules
**The Floating-Only Shadow Rule.** A shadow means "this sits above the page and will go away". Cards, bands, the rail and buttons never have one.

**The No Glow Rule.** No glows, halos, gradients, neon edges or decorative blur. Focus is a 2px amber outline at 2px offset; input focus adds an amber border and a 3px amber ring at 20%.

## Shapes

Simple rectangles with gently rounded corners: 8px (`lg`) for cards, the band, notices, segmented groups and toasts; 6px (`md`) for buttons, inputs, chips and nav items; 4px (`sm`) for badges, kbd and focus outlines; 12px (`xl`) for dialogs, the command palette and the top of bottom sheets. Status dots are 7px circles (hollow ones use a 1.5px ring); mini usage bars are thin rounded bars. Borders are always 1px hairlines; inner divisions are hairline rules, never nested cards. Empty states use a dashed hairline.

## Components

### Buttons
Quiet, rectangular, one shape in four tones. All press to 0.96 scale (none under reduced motion) with 150ms ease-out colour transitions.
- **Shape:** gently rounded (6px), 40px high on desktop, 44px on the phone, 14px text.
- **Primary:** star amber with night text, weight 600; hover lifts to pale star; disabled becomes hairline with muted text.
- **Secondary:** transparent with a strong hairline border and star-white text; hover darkens the border and adds a 3% white wash.
- **Danger:** transparent with a coral border at 55% and coral text. **Danger solid:** final coral fill, only for the last irreversible confirmation.
- **Ghost / Icon:** muted text, hover wash; icon buttons are 36px desktop, 44px phone. **Small:** 12px text, 32px desktop, 44px phone.

### Chips and Segmented Controls
- **Chip:** 1px hairline, 12px muted text, 6px radius; selected chip gets an amber border at 50%, a 7% amber wash and amber text (the range chips 1 saat / 6 saat / 24 saat / 7 gün).
- **Segmented:** a night-surface group with a hairline and 8px radius; the selected segment is an amber 9% wash with amber semibold text.

### Status, Dots and Badges
- **Status dot vocabulary:** filled green = fine; hollow amber ring = needs a look; coral (hollow, or filled where urgency must stand out such as nav marks) = urgent; hollow grey ring = no data; spinner = in progress; x and pause marks for failed and stopped. Always followed by a word or carrying an accessible name.
- **Status line:** 13px, 500, mark plus label with an 8px gap; fine keeps star-white text, other tones tint the text.
- **Badge:** a 1px inset ring in the tone at 35-40%, no fill, 11px semibold slightly tracked text, 4px radius.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** panel on the night ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline; rows inside separated by soft hairlines; sub-sections by a hairline rule with 16px top padding.
- **Card head:** a 52px row with the plate caption on the left and an optional 12px muted card link with an arrow on the right ("Tümü (4) →"), divided from the body by a hairline.
- **Internal Padding:** 20px desktop, 16px phone.

### Notices
Thin tone border (25-30%), a 5-6% tone wash, icon plus text, 8px radius, 14px padding; warning, danger, info and special variants.

### Inputs / Fields
- **Style:** night surface, 1px field-border, 6px radius, 40px desktop / 44px phone, 16px text on the phone.
- **Focus:** amber border plus a 3px amber ring at 20%. **Hover:** border one step lighter.
- **Error / Disabled:** coral border via `aria-invalid`; 50% opacity and not-allowed cursor when disabled.

### Navigation
- **Rail:** see Layout. Nav text 14px, muted at rest, star-white on hover with a 3% wash; current item semibold with the amber bar and wash.
- **Phone tab bar:** five 11px-labelled columns with 20px icons, subtle at rest, star-white and semibold when current with an amber icon and a 2px amber bar on the top edge; attention dots sit at the icon's top right.
- **Command palette:** Ctrl/Cmd+K anywhere, overlay colour, 12px radius, pop shadow; the signature interaction.

### Charts
Lines on the panel, no fills or gradients: first series meter grey, second series info blue (dashed in legends), critical threshold coral, grid on the soft hairline, axis labels 10-11px mono in subtle. The Sunucu card shows one chart at a time; hover shows a vertical hairline and an overlay tooltip with pop shadow.

### Dialogs, Sheets and Toasts
The panel's own dialogs only (confirm, prompt, info); the browser's confirm/alert/prompt are never used. Desktop dialogs pop in (180ms, scale 0.97 to 1); on the phone they and the "Diğer" sheet slide up (220ms) with a 60% black scrim. Toasts sit in overlay colour with the pop shadow.

### Brand Mark "Raf yıldızı"
Three star-white server shelves (90% opacity, fully rounded ends) on a night-ground rounded square (14 on a 64 grid); the top shelf's light is star amber, the others are dark. The same drawing at every size: the inline mark in the rail and login (32px, with a 2px hairline edge), `favicon.svg`, PNGs at 16, 32, 192 and 512, an Apple touch icon at 180 and a maskable 512 from `icon-maskable.svg` (full square, 78% safe zone), a web manifest with background and theme colour night ground, and the `theme-color` meta. All rasters are rendered from the SVG; provenance lives in `apps/web/public/ICONS.md`. The amber shelf light echoes the status-band dots. There is no favicon preview anywhere in the product.

### Login
A centred card on the dotted ground with the brand mark above; password and the 2FA field in the same card.

## Do's and Don'ts

### Do:
- **Do** keep star amber to action, selection, focus, links and "look here", and at most one amber primary button per view.
- **Do** pair every status dot with a word: filled green = fine, amber ring = needs a look, coral = urgent, grey ring = no data.
- **Do** head cards and band cells with the 11px, 0.14em uppercase muted caption.
- **Do** set numbers, ids, versions and machine text in JetBrains Mono with tabular figures, and format every number with `toLocaleString("tr-TR")` (comma decimals, `%` before the value).
- **Do** use 8px card radius, 1px hairlines and hairline-divided rows instead of nested cards.
- **Do** keep every control at least 44px high on the phone.
- **Do** put the fix button on the same row as the problem.
- **Do** use the panel's own dialogs, sheets and toasts for confirmation and feedback.

### Don't:
- **Don't** use shadows on cards, bands, the rail or buttons; the pop shadow is for floating layers only.
- **Don't** add glows, gradients, neon edges, starfields, nebulae or other decorative space imagery.
- **Don't** let colour carry meaning alone, or tint healthy text green.
- **Don't** put the dotted coordinate field anywhere but the page ground.
- **Don't** introduce a second accent hue, or use coral fill except on the final irreversible button.
- **Don't** use mono for sentences or labels, or sizes outside the 10 / 11 / 12 / 13 / 14 / 15 / 16 / 22-24 / 28 ramp.
- **Don't** use the browser's confirm, alert or prompt.
- **Don't** show default-thick scrollbars; keep them thin and night-toned.

**Select (combobox).** Every `select.input` shares the field look with a thin chevron instead of the native arrow (`--select-chevron`, lighter on hover). Where the browser supports `appearance: base-select` (Chrome/Edge 135+), the open list is a panel-coloured popover: overlay surface, strong hairline, 8px radius, 4px inset, 36px rows (44px on phone), hover wash, the selected row in amber with an amber dot at the end, and the chevron turning up while open. Other browsers fall back to the native picker.

