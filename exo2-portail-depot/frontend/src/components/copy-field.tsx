import { Box, Button, Field, Input, Text } from '@chakra-ui/react'
import { useCallback, useRef } from 'react'
import { useCopy } from '../hooks/use-copy'

const TEXT = {
  copy: 'Copier',
  copyLink: 'Copier le lien',
  copied: 'Copie',
  manual: 'Copiez avec Ctrl+C',
}

export const CopyField = ({ label, value }: { label: string; value: string }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  // Selecting the text is what turns "copy it by hand" into a single keystroke
  // instead of a drag across a 60-character link.
  const selectValue = useCallback(() => {
    inputRef.current?.select()
  }, [])
  const { feedback, copy } = useCopy(value, selectValue)

  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      {/* One box, as the kit draws it: the frame is the container's, and the
          field inside it is transparent. The input survives the redesign
          because a refused clipboard selects its text -- replacing it with a
          Text would drop that fallback on a value shown exactly once. */}
      <Box
        display="flex"
        alignItems="center"
        gap="12px"
        w="100%"
        borderWidth="1px"
        borderColor="border"
        borderRadius="l2"
        bg="bg.subtle"
        paddingInline="12px"
        paddingBlock="10px"
        // Scoped to the field, not to any descendant: a bare `_focusWithin`
        // also fires on the copy button, which already draws its own ring --
        // two rings, one inside the other.
        css={{
          '&:has(input:focus-visible)': {
            borderColor: 'brand.solid',
            boxShadow: '0 0 0 1px var(--chakra-colors-brand-solid)',
          },
        }}
      >
        <Input
          ref={inputRef}
          readOnly
          variant="bare"
          value={value}
          flex="1"
          minW="0"
          textStyle="codeLink"
          textOverflow="ellipsis"
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
        {/* Named apart from the PIN's "Copier le code": two copy actions sit in
            the same card, and "Copier" alone does not say which. */}
        <Button
          variant="link"
          size="inline"
          flexShrink="0"
          aria-label={TEXT.copyLink}
          onClick={() => void copy()}
        >
          {feedback === 'copied' ? TEXT.copied : TEXT.copy}
        </Button>
      </Box>
      {feedback === 'idle' ? null : (
        <Text role="status" color="fg.muted" fontSize="12px">
          {feedback === 'copied' ? `${TEXT.copied} ✓` : TEXT.manual}
        </Text>
      )}
    </Field.Root>
  )
}
