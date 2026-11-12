// A small, non-interactive slide picture for proposal previews (chat cards and task results).
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { useImages } from './core/images'

export function Thumb({ slide, width = 300 }: { slide: any; width?: number }) {
  const images = useImages([slide])
  return (
    <div className="pv-thumb" style={{ width, height: (width * 9) / 16 }}>
      <div style={{ transform: `scale(${width / slide.widthPx})`, transformOrigin: '0 0' }}>
        <SlideCanvas slide={slide} selectedIds={[]} images={images} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />
      </div>
    </div>
  )
}
