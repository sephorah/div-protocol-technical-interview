import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireSession } from './auth/require-session'
import { SessionProvider } from './auth/session-provider'
import { DashboardPage } from './pages/dashboard-page'
import { LoginPage } from './pages/login-page'
import { NewRequestPage } from './pages/new-request-page'

export const App = () => (
  <BrowserRouter>
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireSession>
              <DashboardPage />
            </RequireSession>
          }
        />
        {/* Declared BEFORE /requests/:id, which arrives with the detail
            screen: read as an identifier, "new" would make the creation
            screen unreachable. */}
        <Route
          path="/requests/new"
          element={
            <RequireSession>
              <NewRequestPage />
            </RequireSession>
          }
        />
        {/* The client route arrives with C1. Its path is NOT ours to pick:
            the backend composes it (DEPOSIT_PATH in
            backend/src/requests/public-url.ts) and nginx redacts that exact
            prefix from its logs, so it stays /depot until all three change
            together. Lawyer-side paths are English.

            Until then an unknown address goes to the dashboard, which sends
            an anonymous visitor to the login. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </SessionProvider>
  </BrowserRouter>
)
