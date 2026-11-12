// pptx-engine uses Node's Buffer for archive entries; the browser needs the MIT `buffer` package.
import { Buffer } from 'buffer'
;(globalThis as any).Buffer = Buffer
;(globalThis as any).global ||= globalThis
