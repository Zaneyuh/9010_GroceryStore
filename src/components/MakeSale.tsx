import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// ---------- Types ----------

interface CartItem {
  id: number;
  name: string;
  qty: number;
  price: number;
  discountType: DiscountKind;
  discountValue: number;
}

type Stage = "lock" | "pos";
type ModalState = "none" | "tender" | "change" | "discount";
type DiscountKind = "percent" | "fixed" | null;

interface MakeSaleProps {
  storeName?: string;
  laneLabel?: string;
  cashierName?: string;
  cashierInitials?: string;
  taxRate?: number; // e.g. 0.12 for 12% VAT
  transactionPrefix?: string;
}

// ---------- Mock catalog (swap for a real product lookup later) ----------

const catalog: Record<string, number> = {
  "lucky me pancit canton": 15.5,
  "datu puti vinegar 1l": 62,
  "fresh milk 1l": 98,
  "silver swan soy sauce": 45,
  "argentina corned beef": 58,
  "rice 5kg": 285,
};

function findPrice(query: string): number {
  const key = query.trim().toLowerCase();
  if (catalog[key]) return catalog[key];
  const match = Object.keys(catalog).find((k) => k.includes(key));
  if (match) return catalog[match];
  return 35; // fallback mock price for unrecognized items
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

// ---------- Discount math ----------

function unitAfterDiscount(price: number, dType: DiscountKind, dValue: number): number {
  if (!dType || !dValue) return price;
  if (dType === "percent") return Math.max(0, price * (1 - dValue / 100));
  if (dType === "fixed") return Math.max(0, price - dValue);
  return price;
}

function itemUnitPrice(item: CartItem): number {
  return unitAfterDiscount(item.price, item.discountType, item.discountValue);
}

function itemExtPrice(item: CartItem): number {
  return item.qty * itemUnitPrice(item);
}

function itemDiscountAmount(item: CartItem): number {
  return item.qty * (item.price - itemUnitPrice(item));
}

// ---------- Component ----------

export default function MakeSale({
  storeName = "9010 Grocery Store",
  laneLabel = "Cashier Terminal · Lane 2",
  cashierName = "John Doe",
  cashierInitials = "JD",
  taxRate = 0.12,
  transactionPrefix = "TXN-00842",
}: MakeSaleProps) {
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("lock");
  const [employeeCode, setEmployeeCode] = useState("");
  const [lockError, setLockError] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [nextId, setNextId] = useState(1);
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState<ModalState>("none");
  const [amountInput, setAmountInput] = useState("");
  const [tenderError, setTenderError] = useState(false);
  const [changeInfo, setChangeInfo] = useState({ total: 0, change: 0 });

  const [discountItemId, setDiscountItemId] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<DiscountKind>("percent");
  const [discountValueInput, setDiscountValueInput] = useState("");
  const [discountError, setDiscountError] = useState(false);

  // ---- derived totals ----
  const subtotal = useMemo(() => cart.reduce((s, i) => s + itemExtPrice(i), 0), [cart]);
  const discountTotal = useMemo(() => cart.reduce((s, i) => s + itemDiscountAmount(i), 0), [cart]);
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
    // Nothing entered yet — leave this screen entirely and go back to the menu that opened it
    navigate(-1);
  }

  // ---- cart actions ----
  function addItem(raw: string) {
    const name = raw.trim();
    if (!name) return;
    const price = findPrice(name);
    setCart((prev) => {
      const existing = prev.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return prev.map((i) => (i.id === existing.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { id: nextId, name: toTitleCase(name), qty: 1, price, discountType: null, discountValue: 0 }];
    });
    setNextId((n) => n + 1);
  }

  function removeItem(id: number) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id: number, value: string) {
    const q = Math.max(1, parseInt(value, 10) || 1);
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: q } : i)));
  }

  // ---- discount modal ----
  function openDiscount(id: number) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    setDiscountItemId(id);
    setDiscountType(item.discountType || "percent");
    setDiscountValueInput(item.discountValue ? String(item.discountValue) : "");
    setDiscountError(false);
    setModal("discount");
  }

  function closeDiscount() {
    setModal("none");
    setDiscountItemId(null);
  }

  function discountPreviewPrice(): number {
    const item = cart.find((i) => i.id === discountItemId);
    if (!item) return 0;
    const value = parseFloat(discountValueInput);
    const valid = !isNaN(value) && value >= 0 && (discountType === "fixed" || value <= 100);
    return valid ? unitAfterDiscount(item.price, discountType, value) : item.price;
  }

  function applyDiscount() {
    const item = cart.find((i) => i.id === discountItemId);
    if (!item) return;
    const value = parseFloat(discountValueInput);
    const valid = !isNaN(value) && value > 0 && (discountType === "fixed" ? value < item.price : value <= 100);
    if (!valid) {
      setDiscountError(true);
      return;
    }
    setCart((prev) =>
      prev.map((i) => (i.id === discountItemId ? { ...i, discountType, discountValue: value } : i))
    );
    closeDiscount();
  }

  function removeDiscount() {
    if (discountItemId == null) return;
    setCart((prev) =>
      prev.map((i) => (i.id === discountItemId ? { ...i, discountType: null, discountValue: 0 } : i))
    );
    closeDiscount();
  }

  // ---- navigation out of the sale screen ----
  function handleClose(confirmFirst: boolean) {
    if (confirmFirst && cart.length > 0) {
      const ok = window.confirm("Discard this transaction and return to the menu?");
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

  // ---- tender modal ----
  function openTender() {
    if (cart.length === 0) {
      window.alert("Add at least one item before payment.");
      return;
    }
    setAmountInput("");
    setTenderError(false);
    setModal("tender");
  }

  function setQuickAmount(v: number) {
    setAmountInput(v.toFixed(2));
  }

  function setExactAmount() {
    setAmountInput(total.toFixed(2));
  }

  function saveTender() {
    const amt = parseFloat(amountInput);
    if (isNaN(amt) || amt < total) {
      setTenderError(true);
      return;
    }
    setChangeInfo({ total, change: amt - total });
    setModal("change");
  }

  function finishSale() {
    setModal("none");
    setCart([]);
    setStage("lock");
    setEmployeeCode("");
    // Stay on the lock screen for the next customer rather than leaving the module
  }

  // ---------- Render: lock screen ----------
  if (stage === "lock") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F6F4EE]">
        <div className="w-full max-w-[340px] rounded-2xl p-8 text-center bg-white border border-[#E4E0D6]">
          <div className="w-12 h-12 rounded-lg mx-auto mb-4 flex items-center justify-center bg-[#1E3A2F]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p className="font-[Space_Grotesk,sans-serif] text-[16px] font-semibold">Make a Sale</p>
          <p className="text-[12px] mt-1 text-[#6B7169]">Enter your employee code to start a new transaction</p>

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
          {lockError && (
            <p className="text-[11.5px] mt-2 text-[#B4432F]">Enter your employee code to continue.</p>
          )}

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

  // ---------- Render: POS / sale screen ----------
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

      {/* Sale header */}
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <p className="font-[Space_Grotesk,sans-serif] text-[18px] font-semibold">Sales Receipt</p>
          <p className="text-[12px] text-[#6B7169]">Transaction #{transactionPrefix}</p>
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

      {/* Search */}
      <div className="px-8">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7169" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search or enter item name, then press Enter"
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
              <tr className="bg-[#E7EEE9]">
                <th className="text-left font-semibold px-4 py-2.5 text-[#16302A]">Item #</th>
                <th className="text-left font-semibold px-4 py-2.5 text-[#16302A]">Item Name</th>
                <th className="text-center font-semibold px-4 py-2.5 text-[#16302A]">Qty</th>
                <th className="text-right font-semibold px-4 py-2.5 text-[#16302A]">Price</th>
                <th className="text-right font-semibold px-4 py-2.5 text-[#16302A]">Ext Price</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => {
                const unit = itemUnitPrice(item);
                const ext = itemExtPrice(item);
                const hasDiscount = !!item.discountType && item.discountValue > 0;
                const badgeLabel =
                  item.discountType === "percent" ? `-${item.discountValue}%` : `-₱${item.discountValue.toFixed(2)}`;

                return (
                  <tr key={item.id} className="border-t border-[#E4E0D6]">
                    <td className="px-4 py-2.5 text-[#6B7169]">{String(idx + 1).padStart(4, "0")}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {item.name}
                      {hasDiscount && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded ml-1 align-middle bg-[#FCEEDD] text-[#C96E1E]">
                          {badgeLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) => updateQty(item.id, e.target.value)}
                        className="w-12 text-center border border-[#E4E0D6] rounded-md py-0.5 text-[12.5px]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {hasDiscount ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span className="line-through text-[10.5px] text-[#6B7169]">₱{item.price.toFixed(2)}</span>
                          <span>₱{unit.toFixed(2)}</span>
                        </div>
                      ) : (
                        `₱${item.price.toFixed(2)}`
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">₱{ext.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openDiscount(item.id)}
                          title="Apply discount"
                          className={hasDiscount ? "text-[#C96E1E]" : "text-[#6B7169] hover:text-[#C96E1E]"}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                            <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />
                          </svg>
                        </button>
                        <button onClick={() => removeItem(item.id)} className="text-[#6B7169] hover:text-[#B4432F]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cart.length === 0 && (
            <p className="text-center text-[12px] py-8 text-[#6B7169]">
              No items yet — search or scan a product above to begin.
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
            {discountTotal > 0 && (
              <p className="text-[#C96E1E]">Discount: -₱{discountTotal.toFixed(2)}</p>
            )}
            <p>Tax ({Math.round(taxRate * 100)}%): ₱{tax.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#6B7169]">Amount Due</p>
            <p className="font-[Space_Grotesk,sans-serif] text-[24px] font-bold text-[#1E3A2F]">₱{total.toFixed(2)}</p>
          </div>
          <button onClick={openTender} className="text-[14px] font-semibold px-6 py-3 rounded-lg text-white bg-[#E8862E] hover:bg-[#C96E1E]">
            Pay with Cash
          </button>
        </div>
      </div>

      {/* Discount modal */}
      {modal === "discount" && discountItemId != null && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[360px] rounded-2xl p-6 bg-white">
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold mb-1">Apply Discount</p>
            <p className="text-[12px] mb-4 text-[#6B7169]">
              {cart.find((i) => i.id === discountItemId)?.name} · was ₱
              {cart.find((i) => i.id === discountItemId)?.price.toFixed(2)} each
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setDiscountType("percent")}
                className={`rounded-lg py-2.5 text-[13px] font-bold border ${
                  discountType === "percent" ? "border-[#1E3A2F] bg-[#E7EEE9] text-[#1E3A2F]" : "border-[#E4E0D6] text-[#1E3A2F]"
                }`}
              >
                Percentage (%)
              </button>
              <button
                onClick={() => setDiscountType("fixed")}
                className={`rounded-lg py-2.5 text-[13px] font-bold border ${
                  discountType === "fixed" ? "border-[#1E3A2F] bg-[#E7EEE9] text-[#1E3A2F]" : "border-[#E4E0D6] text-[#1E3A2F]"
                }`}
              >
                Fixed Amount (₱)
              </button>
            </div>

            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter value"
              value={discountValueInput}
              onChange={(e) => setDiscountValueInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyDiscount()}
              className="w-full text-[16px] font-semibold text-center rounded-lg py-3 px-3 mb-1 border border-[#E4E0D6] bg-[#F6F4EE]"
              autoFocus
            />
            {discountError && (
              <p className="text-[11.5px] text-center mb-2 text-[#B4432F]">Enter a valid discount value.</p>
            )}

            <div className="rounded-lg p-3 text-center mt-2 bg-[#FCEEDD]">
              <p className="text-[11px] text-[#C96E1E]">New price per item</p>
              <p className="font-[Space_Grotesk,sans-serif] text-[18px] font-bold text-[#C96E1E]">
                ₱{discountPreviewPrice().toFixed(2)}
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={closeDiscount} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
                Cancel
              </button>
              {cart.find((i) => i.id === discountItemId)?.discountType && (
                <button onClick={removeDiscount} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#B4432F] text-[#B4432F] hover:bg-[#FBE8E4]">
                  Remove
                </button>
              )}
              <button onClick={applyDiscount} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#E8862E] hover:bg-[#C96E1E]">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tender modal */}
      {modal === "tender" && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[380px] rounded-2xl p-6 bg-white">
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold mb-1">Tender Cash</p>
            <p className="text-[12px] mb-4 text-[#6B7169]">
              Amount due: <span className="font-semibold text-[#1C1E1B]">₱{total.toFixed(2)}</span>
            </p>

            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter amount received"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTender()}
              className="w-full text-[16px] font-semibold text-center rounded-lg py-3 px-3 mb-1 border border-[#E4E0D6] bg-[#F6F4EE]"
              autoFocus
            />
            {tenderError && (
              <p className="text-[11.5px] text-center mb-3 text-[#B4432F]">Amount must be at least the total due.</p>
            )}

            <div className="grid grid-cols-4 gap-2 mt-3">
              {[10, 20, 50, 100, 200, 500, 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setQuickAmount(v)}
                  className="bg-white border border-[#E4E0D6] rounded-lg py-2.5 text-[13px] font-bold text-[#1E3A2F] hover:border-[#1E3A2F] hover:bg-[#E7EEE9]"
                >
                  ₱{v}
                </button>
              ))}
              <button
                onClick={setExactAmount}
                className="bg-white border border-[#E4E0D6] rounded-lg py-2.5 text-[13px] font-bold text-[#1E3A2F] hover:border-[#1E3A2F] hover:bg-[#E7EEE9]"
              >
                Exact
              </button>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setModal("none")} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]">
                Cancel
              </button>
              <button onClick={saveTender} className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#E8862E] hover:bg-[#C96E1E]">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change modal */}
      {modal === "change" && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[320px] rounded-2xl p-6 text-center bg-white">
            <div className="w-11 h-11 rounded-full mx-auto mb-3 flex items-center justify-center bg-[#E7EEE9]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E3A2F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold mb-4">Payment Complete</p>

            <div className="rounded-lg p-4 flex flex-col gap-2 bg-[#F6F4EE]">
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6B7169]">Total:</span>
                <span className="font-semibold">₱{changeInfo.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6B7169]">Change:</span>
                <span className="font-[Space_Grotesk,sans-serif] font-bold text-[16px] text-[#C96E1E]">
                  ₱{changeInfo.change.toFixed(2)}
                </span>
              </div>
            </div>

            <button onClick={finishSale} className="w-full mt-5 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#1E3A2F] hover:bg-[#16302A]">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}