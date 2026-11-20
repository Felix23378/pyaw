import { useEffect, useState } from 'react'
import { Download, Moon, Settings, Sun, WifiOff } from 'lucide-react'
import { Brand } from './Brand'
import { Button } from './ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useOnline } from '../hooks/useOnline'

export function Header() {
  const theme = useAppStore((state) => state.settings.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const { canInstall, install } = useInstallPrompt()
  const online = useOnline()
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const isDark = theme === 'dark' || (theme === 'system' && systemDark)

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-2 px-4 sm:h-[68px] sm:px-6">
        <Brand />

        <div className="ml-auto flex items-center gap-1">
          {!online && (
            <span className="mr-1 hidden items-center gap-1.5 rounded-full bg-rust/10 px-2.5 py-1 text-[11px] font-medium text-rust sm:inline-flex">
              <WifiOff className="size-3" />
              Offline
            </span>
          )}

          {canInstall && (
            <Button variant="ghost" size="sm" onClick={install} className="px-2.5">
              <Download className="size-4" />
              <span className="hidden sm:inline">Install</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Light theme' : 'Dark theme'}
          >
            {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            title="Settings"
          >
            <Settings className="size-[18px]" />
          </Button>
        </div>
      </div>
    </header>
  )
}
