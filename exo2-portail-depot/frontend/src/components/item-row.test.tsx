import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReceivedFile } from '../api/requests'
import { renderWithTheme } from '../test/render'
import { ItemRow } from './item-row'

const file = (originalName: string): ReceivedFile => ({
  originalName,
  mimeType: 'application/pdf',
  sizeBytes: 2_411_724,
  receivedAt: '2026-03-14T10:32:00.000Z',
})

describe('ItemRow', () => {
  it('shows the file metadata of a received piece', () => {
    renderWithTheme(
      <ItemRow label="Contrat de bail signe" state="received" file={file('contrat-signe.pdf')} />,
    )
    expect(screen.getByText('Contrat de bail signe')).toBeInTheDocument()
    expect(screen.getByText('contrat-signe.pdf')).toBeInTheDocument()
    expect(screen.getByText(/2,3 Mo/)).toBeInTheDocument()
    expect(screen.getByText(/14 mars 2026/)).toBeInTheDocument()
  })

  it('shows "En attente" and no metadata when nothing was deposited', () => {
    renderWithTheme(<ItemRow label="Attestation d'assurance" state="pending" />)
    expect(screen.getByText(/en attente/i)).toBeInTheDocument()
    expect(screen.queryByText(/recu le/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // C2 will write this state. Drawn now so the lawyer screen does not have to
  // be redesigned under pressure the day an upload can fail.
  it('names a failed deposit, keeps the file name, and says what to do', () => {
    renderWithTheme(<ItemRow label="Facture EDF" state="failed" file={file('facture.pdf')} />)
    expect(screen.getByText(/depot echoue/i)).toBeInTheDocument()
    // The name is what lets the lawyer tell the client which one to redo.
    expect(screen.getByText('facture.pdf')).toBeInTheDocument()
    expect(screen.getByText(/deposer a nouveau/i)).toBeInTheDocument()
  })

  // A progress bar is INDICATIVE: 100 % means "sent", not "kept" -- the magic
  // bytes check of C2 can still refuse the file afterwards. The label must
  // never promise more than the server has confirmed.
  it('reads progress as "envoi en cours", never as done', () => {
    renderWithTheme(
      <ItemRow label="Piece d'identite" state="uploading" progress={100} file={file('cni.jpg')} />,
    )
    expect(screen.getByText(/envoi en cours/i)).toBeInTheDocument()
    expect(screen.queryByText(/termine/i)).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  // C3 passes the server's own refusal here -- "Format refuse. PDF, JPG ou PNG
  // uniquement." says what to do, where the default only says something broke.
  it('prefers the caller note to the default wording of a state', () => {
    renderWithTheme(
      <ItemRow
        label="Facture EDF"
        state="failed"
        file={file('facture.gif')}
        note="Format refuse. PDF, JPG ou PNG uniquement."
      />,
    )
    expect(screen.getByText('Format refuse. PDF, JPG ou PNG uniquement.')).toBeInTheDocument()
    expect(screen.queryByText(/deposer a nouveau/i)).not.toBeInTheDocument()
  })

})
