import { Box, Button, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session'

const TEXT = {
  brand: 'Portail de depot',
  signOut: 'Se deconnecter',
}

/**
 * The top bar and the one centred column every lawyer screen sits in.
 *
 * A single column at every width, capped at 1040px: a two-column grid on a
 * large screen would double the desktop's density against the phone's, which is
 * exactly what the density criterion forbids. Only the page gutter changes
 * between the two breakpoints -- 16px, then 24px.
 */
export const AppShell = ({ children }: { children: ReactNode }) => {
  const { lawyer, signOut } = useSession()
  const navigate = useNavigate()

  const onSignOut = async () => {
    await signOut()
    // Awaited: react-router 7 returns a promise, and the button stays disabled
    // until the navigation has actually happened.
    await navigate('/login', { replace: true })
  }

  return (
    <Box minH="100dvh" bg="bg">
      <Box as="header" borderBottomWidth="1px" borderColor="border" bg="bg">
        <Stack
          direction={{ base: 'column', md: 'row' }}
          justify="space-between"
          align={{ base: 'flex-start', md: 'center' }}
          gap="8px"
          maxW="1040px"
          mx="auto"
          px={{ base: '16px', md: '24px' }}
          py="16px"
        >
          <Text asChild fontWeight="600" fontSize="16px" color="brand.fg">
            <RouterLink to="/dashboard">{TEXT.brand}</RouterLink>
          </Text>
          <Stack direction="row" gap="12px" align="center">
            {lawyer === null ? null : (
              <Text color="fg.muted" fontSize="12px">
                {lawyer.email}
              </Text>
            )}
            {/* Stack stretches its children; the button keeps its own box. */}
            <Button
              variant="secondary"
              size="sm"
              alignSelf="center"
              onClick={() => void onSignOut()}
            >
              {TEXT.signOut}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box as="main" maxW="1040px" mx="auto" px={{ base: '16px', md: '24px' }} py="24px">
        {children}
      </Box>
    </Box>
  )
}
