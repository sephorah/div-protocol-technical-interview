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

})
