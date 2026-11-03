// Times are stored as UTC instants (ISO 8601); people read them in their own time zone.
const p2 = (n: number) => String(n).padStart(2, '0')

/** "UTC+8", "UTC-3:30", "UTC" for the viewer's offset at instant `d`. */
export function zoneLabel(d: Date): string {
  const off = -d.getTimezoneOffset(), a = Math.abs(off)
  return off === 0 ? 'UTC' : `UTC${off > 0 ? '+' : '-'}${Math.floor(a / 60)}${a % 60 ? ':' + p2(a % 60) : ''}`
}

/**
 * A stored instant in the viewer's local time: "2026-11-04 01:16 (UTC+8)".
 * `time` gives only the clock ("01:16:05"), for lists that are already about today.
 */
export function localTime(iso: string | undefined | null, opts: { time?: boolean; zone?: boolean } = {}): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  if (opts.time) return `${clock}:${p2(d.getSeconds())}`
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  return `${day} ${clock}${opts.zone === false ? '' : ` (${zoneLabel(d)})`}`
}
