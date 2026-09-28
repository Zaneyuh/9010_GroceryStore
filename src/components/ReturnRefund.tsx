import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// ---------- Types ----------

interface CartItem {
  id: number;
  name: string;
  qty: number;
  price: number;
}

type Stage = "lock" | "pos";
type ModalState = "none" | "refund" | "complete";
type RefundMethod = "Cash" | "Store Credit" | "Original Payment";

interface ReturnRefundProps {
  storeName?: string;
  laneLabel?: string;
  cashierName?: string;
  cashierInitials?: string;
  taxRate?: number;
  returnPrefix?: string;
}

// ---------- Mock data (swap for real lookups later) ----------

const catalog: Record<string, number> = {
  "lucky me pancit canton": 15.5,
  "datu puti vinegar 1l": 62,
  "fresh milk 1l": 98,
  "silver swan soy sauce": 45,
  "argentina corned beef": 58,
  "rice 5kg": 285,
};

interface ReceiptLineItem {
  name: string;
  qty: number;
  price: number;
}

const mockReceipts: Record<string, ReceiptLineItem[]> = {
  "txn-00840": [
    { name: "Lucky Me Pancit Canton", qty: 3, price: 15.5 },
    { name: "Rice 5kg", qty: 1, price: 285 },
  ],
  "txn-00838": [{ name: "Fresh Milk 1L", qty: 2, price: 98 }],
};

function findPrice(query: string): number {
  const key = query.trim().toLowerCase();
  if (catalog[key]) return catalog[key];
  const match = Object.keys(catalog).find((k) => k.includes(key));
  if (match) return catalog[match];
  return 35;
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

// ---------- Component ----------

export default function ReturnRefund({
  storeName = "9010 Grocery Store",
  laneLabel = "Cashier Terminal · Lane 2",
  cashierName = "John Doe",
  cashierInitials = "JD",
  taxRate = 0.12,
  returnPrefix = "RTN-00113",
}: ReturnRefundProps) {
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("lock");
  const [employeeCode, setEmployeeCode] = useState("");
  const [lockError, setLockError] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [nextId, setNextId] = useState(1);
  const [search, setSearch] = useState("");

  const [receiptInput, setReceiptInput] = useState("");
  const [receiptError, setReceiptError] = useState(false);

  const [modal, setModal] = useState<ModalState>("none");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("Cash");
  const [completedInfo, setCompletedInfo] = useState({ total: 0, method: "Cash" as RefundMethod });

  // ---- derived totals ----
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.qty * i.price, 0), [cart]);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const itemCount = cart.length;
  const qtyCount = cart.reduce((s, i) => s + i.qty, 0);

  // ---- lock screen ----
  function handleEnterLock() {
    if (!employeeCode.trim()) {
      setLockError(true);
      return;
    }
    setLockError(false);
    setStage("pos");
    setCart([]);
  }

  function handleCancelLock() {
    navigate(-1);
  }

  // ---- cart actions ----
  function addItem(raw: string, presetQty?: number, presetPrice?: number) {
    const name = raw.trim();
    if (!name) return;
    const price = presetPrice ?? findPrice(name);
    const qty = presetQty ?? 1;
    setCart((prev) => {
      const existing = prev.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return prev.map((i) => (i.id === existing.id ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, { id: nextId, name: toTitleCase(name), qty, price }];
    });
    setNextId((n) => n + 1);
  }

  function lookupReceipt() {
    const key = receiptInput.trim().toLowerCase();
    if (!key) return;
    const found = mockReceipts[key];
    if (!found) {
      setReceiptError(true);
      return;
    }
    setReceiptError(false);
    found.forEach((item) => addItem(item.name, item.qty, item.price));
    setReceiptInput("");
  }

  function removeItem(id: number) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id: number, value: string) {
    const q = Math.max(1, parseInt(value, 10) || 1);
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: q } : i)));
  }

  // ---- navigation out ----
  function handleClose(confirmFirst: boolean) {
    if (confirmFirst && cart.length > 0) {
      const ok = window.confirm("Discard this return and go back to the menu?");
      if (!ok) return;
    }
    setCart([]);
    setStage("lock");
    setEmployeeCode("");
    navigate(-1); // return to whichever menu (Cashier or Owner) launched this screen
  }

  function stubAction(msg: string) {
    window.alert(`${msg} (demo only — not wired to a backend yet)`);
  }

  // ---- refund modal ----
  function openRefund() {
    if (cart.length === 0) {
      window.alert("Add at least one item to return.");
      return;
    }
    setRefundMethod("Cash");
    setModal("refund");
  }

  function confirmRefund() {
    setCompletedInfo({ total, method: refundMethod });
    setModal("complete");
  }

  function finishReturn() {
    setModal("none");
    setCart([]);
    setStage("lock");
    setEmployeeCode("");
    // Stay on the lock screen for the next customer
  }

  // ---------- Render: lock screen ----------
  if (stage === "lock") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F6F4EE]">
        <div className="w-full max-w-[340px] rounded-2xl p-8 text-center bg-white border border-[#E4E0D6]">
          <div className="w-12 h-12 rounded-lg mx-auto mb-4 flex items-center justify-center bg-[#B4432F]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
            </svg>
          </div>
          <p className="font-[Space_Grotesk,sans-serif] text-[16px] font-semibold">Return &amp; Refund</p>
          <p className="text-[12px] mt-1 text-[#6B7169]">Enter your employee code to start a return</p>

          <input
            type="password"
            placeholder="Employee Code"
            maxLength={6}
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnterLock()}
            className="w-full mt-5 text-center tracking-[6px] text-[15px] font-semibold rounded-lg py-3 px-3 border border-[#E4E0D6] bg-[#F6F4EE]"
            autoFocus
          />
          {lockError && <p className="text-[11.5px] mt-2 text-[#B4432F]">Enter your employee code to continue.</p>}

          <div className="flex gap-3 mt-5">
            <button onClick={handleCancelLock} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
              Cancel
            </button>
            <button onClick={handleEnterLock} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#1E3A2F] hover:bg-[#16302A]">
              Enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Render: return screen ----------
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F4EE] text-[#1C1E1B] font-[Manrope,sans-serif]">
      {/* NavBar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-[#E4E0D6] bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md flex items-center justify-center bg-[#1E3A2F]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6A1 1 0 0 0 5.6 19H17" />
              <circle cx="9" cy="21" r="1" /><circle cx="17" cy="21" r="1" />
            </svg>
          </div>
          <div>
            <p className="font-[Space_Grotesk,sans-serif] text-[14px] font-semibold leading-tight">{storeName}</p>
            <p className="text-[11px] text-[#6B7169]">{laneLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-[#E8862E]">
            {cashierInitials}
          </div>
          <p className="text-[12.5px] font-semibold">{cashierName}</p>
        </div>
      </header>

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <p className="font-[Space_Grotesk,sans-serif] text-[18px] font-semibold">Sales Receipt — Return</p>
          <p className="text-[12px] text-[#6B7169]">Return #{returnPrefix}</p>
        </div>
        <button
          onClick={() => handleClose(true)}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-[#E4E0D6] text-[#6B7169] hover:bg-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Receipt lookup (optional) */}
      <div className="px-8">
        <div className="rounded-lg p-3 mb-3 flex items-center gap-2 bg-[#E7EEE9] border border-[#E4E0D6]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1E3A2F" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M6 2h9l3 3v17l-3-2-2.5 2-2.5-2-2.5 2-2.5-2-3 2V5a3 3 0 0 1 3-3Z" />
          </svg>
          <input
            type="text"
            placeholder="Optional: look up a receipt # to pull in the original items"
            value={receiptInput}
            onChange={(e) => setReceiptInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookupReceipt()}
            className="flex-1 bg-transparent text-[12.5px] focus:outline-none text-[#16302A] placeholder:text-[#6B7169]/70"
          />
          <button onClick={lookupReceipt} className="text-[12px] font-semibold px-3 py-1.5 rounded-md text-white bg-[#1E3A2F]">
            Find
          </button>
        </div>
        {receiptError && <p className="text-[11.5px] mb-2 text-[#B4432F]">No receipt found with that number.</p>}
      </div>

      {/* Manual search */}
      <div className="px-8">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7169" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Or search/enter an item to return manually, then press Enter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addItem(search);
                setSearch("");
              }
            }}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border border-[#E4E0D6] bg-white"
          />
        </div>
      </div>

      {/* Item table */}
      <div className="px-8 mt-4 flex-1">
        <div className="rounded-xl overflow-hidden border border-[#E4E0D6] bg-white">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#FBE8E4]">
                <th className="text-left font-semibold px-4 py-2.5 text-[#B4432F]">Item #</th>
                <th className="text-left font-semibold px-4 py-2.5 text-[#B4432F]">Item Name</th>
                <th className="text-center font-semibold px-4 py-2.5 text-[#B4432F]">Qty</th>
                <th className="text-right font-semibold px-4 py-2.5 text-[#B4432F]">Price</th>
                <th className="text-right font-semibold px-4 py-2.5 text-[#B4432F]">Ext Price</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => (
                <tr key={item.id} className="border-t border-[#E4E0D6]">
                  <td className="px-4 py-2.5 text-[#6B7169]">{String(idx + 1).padStart(4, "0")}</td>
                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateQty(item.id, e.target.value)}
                      className="w-12 text-center border border-[#E4E0D6] rounded-md py-0.5 text-[12.5px]"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">₱{item.price.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-[#B4432F]">-₱{(item.qty * item.price).toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button onClick={() => removeItem(item.id)} className="text-[#6B7169] hover:text-[#B4432F]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cart.length === 0 && (
            <p className="text-center text-[12px] py-8 text-[#6B7169]">
              No items yet — look up a receipt above or search for an item to return.
            </p>
          )}
        </div>
      </div>

      {/* Summary + actions */}
      <div className="px-8 py-4 mt-3 border-t border-[#E4E0D6] bg-white flex items-end justify-between gap-6">
        <div className="flex gap-2">
          <button onClick={() => stubAction("Held")} className="text-[12.5px] font-semibold px-4 py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
            Put on Hold
          </button>
          <button onClick={() => handleClose(true)} className="text-[12.5px] font-semibold px-4 py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
            Cancel
          </button>
          <button onClick={() => stubAction("Saved")} className="text-[12.5px] font-semibold px-4 py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
            Save Only
          </button>
          <button onClick={() => stubAction("Saved & queued to print")} className="text-[12.5px] font-semibold px-4 py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
            Save &amp; Print
          </button>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right text-[12px] text-[#6B7169]">
            <p>{itemCount} items · {qtyCount} qty</p>
            <p>Tax ({Math.round(taxRate * 100)}%): -₱{tax.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#6B7169]">Refund Due</p>
            <p className="font-[Space_Grotesk,sans-serif] text-[24px] font-bold text-[#B4432F]">-₱{total.toFixed(2)}</p>
          </div>
          <button onClick={openRefund} className="text-[14px] font-semibold px-6 py-3 rounded-lg text-white bg-[#B4432F] hover:bg-[#98362A]">
            Process Refund
          </button>
        </div>
      </div>

      {/* Refund method modal */}
      {modal === "refund" && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[380px] rounded-2xl p-6 bg-white">
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold mb-1">Confirm Refund</p>
            <p className="text-[12px] mb-4 text-[#6B7169]">
              Refund due: <span className="font-semibold text-[#B4432F]">-₱{total.toFixed(2)}</span>
            </p>

            <p className="text-[12px] font-semibold mb-2">Refund method</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {(["Cash", "Store Credit", "Original Payment"] as RefundMethod[]).map((method) => (
                <button
                  key={method}
                  onClick={() => setRefundMethod(method)}
                  className={`rounded-lg py-2.5 text-[12px] font-semibold border ${
                    refundMethod === method
                      ? "border-[#1E3A2F] bg-[#E7EEE9] text-[#16302A]"
                      : "border-[#E4E0D6] bg-white text-[#1C1E1B]"
                  }`}
                >
                  {method === "Original Payment" ? "Original" : method}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setModal("none")} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
                Cancel
              </button>
              <button onClick={confirmRefund} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#B4432F] hover:bg-[#98362A]">
                Confirm Refund
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completion modal */}
      {modal === "complete" && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[320px] rounded-2xl p-6 text-center bg-white">
            <div className="w-11 h-11 rounded-full mx-auto mb-3 flex items-center justify-center bg-[#FBE8E4]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B4432F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold mb-4">Refund Complete</p>

            <div className="rounded-lg p-4 flex flex-col gap-2 bg-[#F6F4EE]">
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6B7169]">Total Refunded:</span>
                <span className="font-semibold text-[#B4432F]">-₱{completedInfo.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6B7169]">Method:</span>
                <span className="font-semibold">{completedInfo.method}</span>
              </div>
            </div>

            <button onClick={finishReturn} className="w-full mt-5 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#1E3A2F] hover:bg-[#16302A]">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}