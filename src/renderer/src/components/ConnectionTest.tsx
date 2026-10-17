import type { JSX } from 'react'
import { useState } from 'react'
import type { ConnectionTestResult } from '../../../shared/types'
import { strings } from '../strings'
import { Button } from './ui/Button'
import { IconCheck, IconAlert } from './icons'
import { ErrorDetail } from './ErrorDetail'
import { failedTest } from '../connectionTest'

type State = 'idle' | 'testing' | 'ok' | 'error'

interface Props {
  run: () => Promise<ConnectionTestResult>
  /** Optional label override for the button. */
  label?: string
}

/** "Testa anslutning" button + inline plain-language result with detail toggle. */
export function ConnectionTest({ run, label }: Props): JSX.Element {
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<ConnectionTestResult | null>(null)

  const test = async (): Promise<void> => {
    setState('testing')
    try {
      const r = await run()
      setResult(r)
      setState(r.ok ? 'ok' : 'error')
    } catch (e) {
      setResult(failedTest(e))
      setState('error')
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <Button variant="secondary" size="sm" onClick={test} loading={state === 'testing'}>
          {state === 'testing'
            ? strings.settings.testing
            : (label ?? strings.settings.testConnection)}
        </Button>
      </div>

      {state === 'ok' && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success animate-fade-in">
          <IconCheck size={17} />
          {result?.message ?? strings.settings.testOk}
        </p>
      )}

      {state === 'error' && result && (
        <div className="animate-fade-in">
          <p className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <IconAlert size={17} className="mt-0.5 shrink-0" />
            <span>{result.message}</span>
          </p>
          {result.detail && <ErrorDetail detail={result.detail} className="mt-1.5 ml-6" />}
        </div>
      )}
    </div>
  )
}
