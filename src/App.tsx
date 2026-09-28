import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import CashierMainMenu from './components/CashierMainMenu'
import OwnerMainMenu from './components/OwnerMainMenu'
import MakeSale from './components/MakeSale'
import ReturnRefund from './components/ReturnRefund'

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Temporary default route until a real login screen exists.
            Change this (or add a "/" login/role-picker) once auth is built. */}
        <Route path="/" element={<Navigate to="/cashier" replace />} />

        <Route path="/cashier" element={<CashierMainMenu />} />
        <Route path="/owner" element={<OwnerMainMenu />} />
        <Route path="/make-a-sale" element={<MakeSale />} />
        <Route path="/return-refund" element={<ReturnRefund />} />
      </Routes>
    </HashRouter>
  )
}

export default App