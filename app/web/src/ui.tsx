// Shell primitives (M6): icons, tooltips and menus on Radix (MIT), and the theme setting.
import React, { useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Dropdown from '@radix-ui/react-dropdown-menu'

const paths: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  evidence: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3Z',
  data: 'M3 5h18M3 12h18M3 19h18M8 5v14M16 5v14',
  tasks: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  panel: 'M3 5h18v14H3zM15 5v14',
  export: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  sun: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  journal: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
}
export function Icon({ name }: { name: keyof typeof paths | string }) {
  if (name === 'more') return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name] ?? ''} /></svg>
}

export function Tip({ label, kbd, children }: { label: string; kbd?: string; children: React.ReactElement }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tip" sideOffset={6}>{label}{kbd && <kbd>{kbd}</kbd>}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  )
}

export const IconButton = React.forwardRef<HTMLButtonElement, { icon: string; label: string; kbd?: string; on?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function IconButton({ icon, label, kbd, on, ...rest }, ref) {
    return <Tip label={label} kbd={kbd}><button ref={ref} className="icon-btn" aria-label={label} data-on={on ? 'true' : undefined} {...rest}><Icon name={icon} /></button></Tip>
  })

export interface MenuItem { label: string; icon?: string; onSelect?: () => void; disabled?: boolean; separator?: boolean; heading?: boolean; testId?: string }
export function Menu({ trigger, items, align = 'end' }: { trigger: React.ReactElement; items: MenuItem[]; align?: 'start' | 'end' }) {
  return (
    // non-modal: a modal menu sets pointer-events:none on <body>, and a dialog opened from one of its items ("Use anyway")
    // restored that value on close, leaving the whole app unclickable
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align={align} sideOffset={6}>
          {items.map((it, i) => it.separator ? <Dropdown.Separator key={i} className="menu-sep" />
            : it.heading ? <Dropdown.Label key={i} className="menu-label">{it.label}</Dropdown.Label>
            : <Dropdown.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect} data-menu={it.testId}>{it.icon && <Icon name={it.icon} />}{it.label}</Dropdown.Item>)}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

export const TooltipProvider = Tooltip.Provider

/** 'system' follows the OS; 'light'/'dark' are kept per browser (a convenience, so storage failures are ignored). */
export function useTheme(): ['system' | 'light' | 'dark', (t: 'system' | 'light' | 'dark') => void] {
  const [theme, set] = useState<'system' | 'light' | 'dark'>(() => { try { return (localStorage.getItem('frr-theme') as any) || 'system' } catch { return 'system' } })
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try { localStorage.setItem('frr-theme', theme) } catch { /* private mode */ }
  }, [theme])
  return [theme, set]
}
export const isDark = (theme: string) => theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
