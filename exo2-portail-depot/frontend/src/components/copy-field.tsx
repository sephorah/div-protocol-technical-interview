import { Box, Button, Field, Input, Stack, Text } from '@chakra-ui/react'
import { useCallback, useRef } from 'react'
import { useCopy } from '../hooks/use-copy'

const TEXT = {
  copy: 'Copier',
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
      <Stack direction="row" gap="8px" align="center" w="100%">
        <Box flex="1" minW="0">
          <Input
            ref={inputRef}
            readOnly
            value={value}
            textStyle="codeLink"
            textOverflow="ellipsis"
            onFocus={(event) => {
              event.currentTarget.select()
            }}
          />
        </Box>
        {/* Stack stretches its children; the button keeps its own box. */}
        <Button variant="secondary" size="sm" flexShrink="0" alignSelf="center" onClick={() => void copy()}>
          {feedback === 'copied' ? TEXT.copied : TEXT.copy}
        </Button>
      </Stack>
      {feedback === 'idle' ? null : (
        <Text role="status" color="fg.muted" fontSize="12px">
          {feedback === 'copied' ? `${TEXT.copied} ✓` : TEXT.manual}
        </Text>
      )}
    </Field.Root>
  )
}
