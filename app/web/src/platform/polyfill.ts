// pptx-engine stores archive entries as Node Buffers; the browser gets the MIT `buffer` package.
import { Buffer } from 'buffer'

const g = globalThis as any
g.Buffer ||= Buffer
g.global ||= globalThis
