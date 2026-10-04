import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import Orders from './pages/Orders';
import POS from './pages/POS';
import Table from './pages/Table';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import AuthGuard from './components/AuthGuard';
import POSOpeningProvider from './components/POSOpeningProvider';
import ScreenSizeProvider from './components/ScreenSizeProvider';
import KotAlertListener from './components/KotAlertListener';
import QzPrintAgent from './components/QzPrintAgent';
import CaptainRouteGuard from './captain/components/CaptainRouteGuard';
import CaptainWorkspace from './captain/pages/CaptainWorkspace';
import { ToastProvider } from '@ury/ui';
import { usePOSStore } from './store/pos-store';
import { useEffect } from 'react';

/** Old per-table captain links now open the single workspace on that table. */
function LegacyCaptainTableRedirect() {
  const { table } = useParams<{ table: string }>();
  return <Navigate to={table ? `/order?table=${encodeURIComponent(table)}` : '/order'} replace />;
}

function App() {
  const {
    initializeApp
  } = usePOSStore();
  
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  return (
    <>
      <ToastProvider />
      <KotAlertListener />
      <QzPrintAgent />
      <ScreenSizeProvider>
        <AuthGuard>
          <POSOpeningProvider>
            <Router basename="/pos">
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/pos" element={<POS />} />
                  <Route path="/tables" element={<Table />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                {/*
                  Captain "Order" module — its own shell, sibling to the
                  Cashier POS routes above, not nested under AppLayout
                  (PLAN.md §6/§10: own navigation, mobile-first, not the
                  desktop Header/Footer shell). One workspace screen; the
                  open table is the `?table=` query param. This Router (basename
                  "/ury") is already the outer app-nesting layer that mounts
                  "/pos" today, so "/order" sits alongside it here rather
                  than in a separate outer router file.
                */}
                <Route
                  path="/order"
                  element={
                    <CaptainRouteGuard>
                      <CaptainWorkspace />
                    </CaptainRouteGuard>
                  }
                />
                <Route path="/order/table/:table" element={<LegacyCaptainTableRedirect />} />
              </Routes>
            </Router>
          </POSOpeningProvider>
        </AuthGuard>
      </ScreenSizeProvider>
    </>
  );
}

export default App;
