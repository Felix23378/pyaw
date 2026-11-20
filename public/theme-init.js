try {
  const raw = localStorage.getItem('pyaw-store')
  const theme = raw ? JSON.parse(raw)?.state?.settings?.theme : 'system'
  const dark =
    theme === 'dark' ||
    ((!theme || theme === 'system') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
} catch {
  // ignore storage/parse errors
}
