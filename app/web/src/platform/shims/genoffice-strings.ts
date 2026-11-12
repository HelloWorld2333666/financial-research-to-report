// GenOffice ships its editor's interface text in 22 languages (about 1.6 MB of the bundle). This app's interface
// is English, and GenOffice's own lookup falls back en → zh → key, so only those two dictionaries are bundled.
// vite.config.ts points renderer/i18n/locale.tsx's `./strings` import here; the vendored files are unchanged.
import { zh as appZh } from '@genoffice-slides/renderer/i18n/app/zh'
import { en as appEn } from '@genoffice-slides/renderer/i18n/app/en'
import { zh as ribbonZh } from '@genoffice-slides/renderer/i18n/ribbon/zh'
import { en as ribbonEn } from '@genoffice-slides/renderer/i18n/ribbon/en'
import { zh as panesZh } from '@genoffice-slides/renderer/i18n/panes/zh'
import { en as panesEn } from '@genoffice-slides/renderer/i18n/panes/en'
import { zh as aiZh } from '@genoffice-slides/renderer/i18n/ai/zh'
import { en as aiEn } from '@genoffice-slides/renderer/i18n/ai/en'

export const strings = {
  zh: { ...appZh, ...ribbonZh, ...panesZh, ...aiZh },
  en: { ...appEn, ...ribbonEn, ...panesEn, ...aiEn },
}
