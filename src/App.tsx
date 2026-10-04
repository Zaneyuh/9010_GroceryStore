import { HashRouter, Routes, Route } from 'react-router-dom'
import CashierMainMenu from './components/CashierMainMenu'
import OwnerMainMenu from './components/OwnerMainMenu'
import MakeSale from './components/MakeSale'
import ReturnRefund from './components/ReturnRefund'
import ReceiptHistory from './components/ReceiptHistory'
import Workspace from './components/Workspace'

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Workspace is the primary entry point; legacy role screens remain routable below. */}
        <Route path="/" element={<Workspace />} />

        <Route path="/cashier" element={<CashierMainMenu />} />
        <Route path="/owner" element={<OwnerMainMenu />} />
        <Route path="/make-a-sale" element={<MakeSale />} />
        <Route path="/return-refund" element={<ReturnRefund />} />
        <Route path="/receipt-history" element={<ReceiptHistory />} />
      </Routes>
    </HashRouter>
  )
}

export default App