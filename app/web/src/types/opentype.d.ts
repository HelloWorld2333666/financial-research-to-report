// opentype.js ships no type declarations; we only call parse(), which returns a font the renderer measures with.
declare module 'opentype.js' {
  export function parse(buffer: ArrayBuffer): any
}
