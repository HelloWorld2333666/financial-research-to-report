// Pictures for the slide canvas. SlideCanvas draws a picture only when its URL is in the `images` map; this loads every
// image a render tree refers to (pictures, picture fills, picture backgrounds; data: or blob: URLs from the deck's media
// resolver), caches them across renders, and re-renders the caller when new ones arrive.
import { useEffect, useMemo, useState } from 'react'

const cache = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<void>>()

export function imageUrls(trees: any[]): string[] {
  const urls = new Set<string>()
  const walk = (x: any) => { if (!x || typeof x !== 'object') return; for (const [k, v] of Object.entries(x)) { if (typeof v === 'string' && (k === 'dataUrl' || k === 'image') && /^(data:image|blob:)/.test(v)) urls.add(v); else if (typeof v === 'object') walk(v) } }
  trees.forEach(walk)
  return [...urls]
}

function load(u: string): Promise<void> {
  if (cache.has(u)) return Promise.resolve()
  if (!pending.has(u)) pending.set(u, new Promise<void>((res) => { const im = new Image(); im.onload = () => { cache.set(u, im); res() }; im.onerror = () => res(); im.src = u }))
  return pending.get(u)!
}

/** Every image the trees refer to, loaded (for one-off renders such as the render page). */
export async function loadImages(trees: any[]): Promise<Map<string, HTMLImageElement>> {
  await Promise.all(imageUrls(trees).map(load))
  return new Map(cache)
}

/** The image map for live canvases: what is already loaded now, the rest as it arrives. */
export function useImages(trees: any[]): Map<string, HTMLImageElement> {
  const urls = useMemo(() => imageUrls(trees), [trees])
  const [, bump] = useState(0)
  useEffect(() => {
    let live = true
    const missing = urls.filter((u) => !cache.has(u))
    if (missing.length) Promise.all(missing.map(load)).then(() => live && bump((n) => n + 1))
    return () => { live = false }
  }, [urls])
  return useMemo(() => new Map(urls.filter((u) => cache.has(u)).map((u) => [u, cache.get(u)!])), [urls, cache.size])
}
