import { useEffect, useState } from 'react'
import type { LocalAiComponent, LocalAiComponentStatus } from '../../../shared/types'

export interface LocalAiManager {
  statuses: LocalAiComponentStatus[]
  install(component: LocalAiComponent): Promise<void>
  remove(component: LocalAiComponent): Promise<void>
}

/** Every local AI component's status, kept current from install progress events. */
export function useLocalAiComponents(): LocalAiManager {
  const [statuses, setStatuses] = useState<LocalAiComponentStatus[]>([])

  useEffect(() => {
    let active = true
    void window.api.listLocalAiComponents().then((items) => active && setStatuses(items))
    const unsubscribe = window.api.onLocalAiComponentProgress((next) => {
      setStatuses((current) => [
        ...current.filter((item) => item.component !== next.component),
        next
      ])
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return {
    statuses,
    install: async (component) => {
      const status = await window.api.installLocalAiComponent(component)
      setStatuses((current) => [...current.filter((item) => item.component !== component), status])
    },
    remove: async (component) => {
      await window.api.removeLocalAiComponent(component)
      setStatuses((current) => [
        ...current.filter((item) => item.component !== component),
        { component, state: 'not-installed' }
      ])
    }
  }
}
