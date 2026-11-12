// Browser stand-in for node:zlib (pptx-engine media-insert uses deflateSync for PNG encoding).
import { zlibSync } from 'fflate'
export const deflateSync = (data: Uint8Array) => zlibSync(data)
