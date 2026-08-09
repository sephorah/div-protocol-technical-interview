import { Box, Button, Heading, Stack, Text } from '@chakra-ui/react'
import { useSession } from '../auth/session'

// Replaced by B5. It exists so the redirect after login leads somewhere
// verifiable, not to prefigure the dashboard.
export const DashboardPlaceholder = () => {
  const { lawyer, signOut } = useSession()
  return (
    <Box p="24px">
      <Stack gap="12px" align="flex-start">
        <Heading size="lg">Tableau de bord</Heading>
        <Text color="fg.muted">Connecte en tant que {lawyer?.email}</Text>
        <Button variant="secondary" size="sm" onClick={() => void signOut()}>
          Se deconnecter
        </Button>
      </Stack>
    </Box>
  )
}
