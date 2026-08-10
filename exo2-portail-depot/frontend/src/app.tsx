import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LawyerArea } from './auth/lawyer-area'
import { RequireSession } from './auth/require-session'
import { DashboardPage } from './pages/dashboard-page'
import { DepositPage } from './pages/deposit-page'
import { LoginPage } from './pages/login-page'
import { NewRequestPage } from './pages/new-request-page'
import { RequestDetailPage } from './pages/request-detail-page'

export const App = () => (
  <BrowserRouter>
    <Routes>
      {/* The client's route, OUTSIDE the lawyer session provider: an anonymous
          visitor must not have /auth/me called from their browser. Its path is
          not ours to pick -- the backend composes it (DEPOSIT_PATH in
          backend/src/requests/public-url.ts) and nginx redacts that exact
          prefix from its access log, so /deposit only moves if all three move
          together. */}
      <Route path="/deposit/:token" element={<DepositPage />} />

      <Route element={<LawyerArea />}>
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
        {/* Declared BEFORE /requests/:id: read as an identifier, "new" would
            make the creation screen unreachable. */}
        <Route
          path="/requests/new"
          element={
            <RequireSession>
              <NewRequestPage />
            </RequireSession>
          }
        />
        <Route
          path="/requests/:id"
          element={
            <RequireSession>
              <RequestDetailPage />
            </RequireSession>
          }
        />
        {/* An unknown address goes to the dashboard, which sends an anonymous
            visitor to the login. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>
)
