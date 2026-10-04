import { HashRouter, Routes, Route } from 'react-router-dom'
import CashierMainMenu from './components/CashierMainMenu'
import OwnerMainMenu from './components/OwnerMainMenu'
import MakeSale from './components/MakeSale'
import ReturnRefund from './components/ReturnRefund'
import ReceiptHistory from './components/ReceiptHistory'
import Login from './components/Login'
import Workspace from './components/Workspace'
import { StoreProvider } from './store/StoreContext'

function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routes>
          {/* PIN sign-in is the entry point; the Workspace is the main app. Legacy role screens remain routable below. */}
          <Route path="/" element={<Login />} />
          <Route path="/workspace" element={<Workspace />} />

          <Route path="/cashier" element={<CashierMainMenu />} />
          <Route path="/owner" element={<OwnerMainMenu />} />
          <Route path="/make-a-sale" element={<MakeSale />} />
          <Route path="/return-refund" element={<ReturnRefund />} />
          <Route path="/receipt-history" element={<ReceiptHistory />} />
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}

export default App
