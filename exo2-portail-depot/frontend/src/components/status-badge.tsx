import { Badge } from '@chakra-ui/react'
import type { LinkState, RequestStatus } from '../api/requests'

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'En attente',
  complete: 'Complete',
  expired: 'Expiree',
}

const LINK_LABEL: Record<LinkState, string> = {
  active: 'Lien actif',
  revoked: 'Lien revoque',
}

// The variants are named after the API statuses (badge recipe, E1), so there is
// no mapping table to keep in sync -- only the French labels.
export const StatusBadge = ({ status }: { status: RequestStatus }) => (
  <Badge variant={status}>{STATUS_LABEL[status]}</Badge>
)

/**
 * Beside the status, never instead of it: a request can be COMPLETE and its
 * link REVOKED, and one pill would drop whichever fact it did not carry --
 * leaving the lawyer unable to tell whether to regenerate.
 */
export const LinkStateBadge = ({ state }: { state: LinkState }) => (
  <Badge variant={state === 'active' ? 'info' : 'revoked'}>{LINK_LABEL[state]}</Badge>
)
