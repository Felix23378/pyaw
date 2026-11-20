import { useSyncExternalStore } from 'react'
import { getHealth, subscribeHealth } from '../retry/health'

export function useHealth() {
  return useSyncExternalStore(subscribeHealth, getHealth, getHealth)
}
