import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('test environment', () => {
  it('renders into a DOM and exposes jest-dom matchers', () => {
    render(<p>bonjour</p>)
    expect(screen.getByText('bonjour')).toBeInTheDocument()
  })
})
