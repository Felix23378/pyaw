import { ArrowRight, KeyRound, Mic, ShieldCheck, Sparkles } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

const STEPS = [
  {
    icon: KeyRound,
    title: 'Bring a Gemini key',
    body: 'Paste a key from Google AI Studio. It stays in this browser and is only sent to Google.',
  },
  {
    icon: Mic,
    title: 'Allow the microphone',
    body: 'Tap the big mic and speak naturally in Burmese. English words are kept as they are.',
  },
  {
    icon: Sparkles,
    title: 'Copy and keep',
    body: 'The transcript streams in, saves to Recent thoughts, and is one tap from your clipboard.',
  },
]

export function WelcomeSheet() {
  const open = useAppStore((store) => store.welcomeOpen)
  const setWelcomeOpen = useAppStore((store) => store.setWelcomeOpen)
  const setOnboarded = useAppStore((store) => store.setOnboarded)
  const setSettingsOpen = useAppStore((store) => store.setSettingsOpen)

  const dismiss = () => {
    setWelcomeOpen(false)
    setOnboarded(true)
  }

  const addKey = () => {
    setWelcomeOpen(false)
    setOnboarded(true)
    setSettingsOpen(true)
  }

  return (
    <Modal open={open} onClose={dismiss} labelledBy="welcome-title">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 512 512" aria-hidden="true" className="size-12 rounded-2xl shadow-sm">
            <rect width="512" height="512" rx="112" fill="#181512" />
            <circle cx="256" cy="252" r="164" fill="#E09A2B" />
            <rect x="220" y="142" width="72" height="148" rx="36" fill="#181512" />
            <path
              d="M182 262a74 74 0 0 0 148 0"
              stroke="#181512"
              strokeWidth="24"
              fill="none"
              strokeLinecap="round"
            />
            <path d="M256 336v48" stroke="#181512" strokeWidth="24" strokeLinecap="round" />
            <path d="M208 384h96" stroke="#181512" strokeWidth="24" strokeLinecap="round" />
          </svg>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Pyaw · ပြော
            </p>
            <h2 id="welcome-title" className="text-xl font-semibold tracking-tight">
              Speak first. Type never.
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted">
          A quiet little place for Myanmar thoughts. Record your voice, get clean Burmese
          text, and copy it anywhere.
        </p>

        <div className="mt-5 rounded-2xl border border-line bg-surface-2/50 px-4 py-3.5">
          <p className="font-mm text-[15px] leading-[1.9] text-ink">
            မြန်မာစကားပြောပြီး စာသားအဖြစ် ချက်ချင်း ရယူပါ။
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted">
            Speak Myanmar · get text
          </p>
        </div>

        <ol className="mt-5 space-y-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            return (
              <li key={step.title} className="flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-marigold-soft/50 text-marigold-deep">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className="mr-1 text-muted">{index + 1}.</span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="lg" onClick={addKey} className="flex-1">
            Add a Gemini key
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="secondary" size="lg" onClick={dismiss} className="flex-1">
            Explore first
          </Button>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-3 shrink-0" />
          No accounts. No analytics. Audio goes only to Google’s Gemini API. Keys and transcripts
          stay on this device.
        </p>
      </div>
    </Modal>
  )
}
