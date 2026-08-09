import { ChakraProvider, Field, Input } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { system } from '../index'

describe('field recipe', () => {
  // If getByLabelText fails here, Field.Label is not wired to the Input --
  // the accessibility defect this test exists to catch, not a styling one.
  it('links the label to the input and marks it invalid by state', () => {
    render(
      <ChakraProvider value={system}>
        <Field.Root invalid>
          <Field.Label>Adresse e-mail</Field.Label>
          <Input defaultValue="x" />
          <Field.ErrorText>Identifiants refuses.</Field.ErrorText>
        </Field.Root>
      </ChakraProvider>,
    )
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Identifiants refuses.')).toBeInTheDocument()
  })

  it('sets the label at the charter 12px / 600', () => {
    const base = system.getSlotRecipe('field').base as
      | Record<string, Record<string, unknown>>
      | undefined
    expect(base?.label).toMatchObject({ fontSize: '12px', fontWeight: 600 })
  })

  // A ring, not a wider border: widening the border on focus shifts the next
  // line by a pixel every time the field is entered.
  it('rings the input on focus instead of thickening its border', () => {
    const base = system.getRecipe('input').base as Record<string, unknown> | undefined
    const focus = base?._focusVisible as Record<string, unknown> | undefined
    expect(focus?.boxShadow).toContain('brand-solid')
    expect(focus?.borderWidth).toBeUndefined()
    expect(base?.borderRadius).toBe('l2')
  })
})
