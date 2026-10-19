import type { JSX, ReactNode } from 'react'
import { strings } from '../../strings'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'

/** One block on the settings page: a heading, a line on what it is for, its fields. */
export function Section({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): JSX.Element {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="text-sm text-fg-muted mt-0.5">{description}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  )
}

export function SaveRow({ onSave, saving }: { onSave: () => void; saving: boolean }): JSX.Element {
  return (
    <div className="pt-1">
      <Button variant="primary" size="sm" onClick={onSave} loading={saving}>
        {strings.common.save}
      </Button>
    </div>
  )
}
