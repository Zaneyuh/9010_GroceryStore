import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// ---------- Types ----------

interface ReceiptLineItem {
  name: string;
  qty: number;
  price: number;
}

type Period = "Today" | "Yesterday" | "This Week" | "This Month" | "All Time";

interface Receipt {
  receipt: string;
  datetime: string;
  employee: string;
  period: Period;
  items: ReceiptLineItem[];
}

type SortKey = "datetime" | "receipt" | "employee" | "qty" | "total";
type SortDir = "asc" | "desc";

interface ReceiptHistoryProps {
  storeName?: string;
  laneLabel?: string;
  cashierName?: string;
  cashierInitials?: string;
  taxRate?: number;
  receipts?: Receipt[];
}

// ---------- Mock data (swap for a real transaction query later) ----------

const defaultReceipts: Receipt[] = [
  { receipt: "TXN-00842", datetime: "2026-09-24 12:41 PM", employee: "John Doe", period: "Today",
    items: [{ name: "Fresh Milk 1L", qty: 2, price: 98 }, { name: "Rice 5kg", qty: 1, price: 285 }] },
  { receipt: "TXN-00841", datetime: "2026-09-24 11:15 AM", employee: "Maria Jimenez", period: "Today",
    items: [{ name: "Lucky Me Pancit Canton", qty: 5, price: 15.5 }] },
  { receipt: "TXN-00840", datetime: "2026-09-24 09:52 AM", employee: "John Doe", period: "Today",
    items: [{ name: "Datu Puti Vinegar 1L", qty: 1, price: 62 }, { name: "Rice 5kg", qty: 1, price: 285 }] },
  { receipt: "TXN-00838", datetime: "2026-09-23 04:20 PM", employee: "Maria Jimenez", period: "Yesterday",
    items: [{ name: "Fresh Milk 1L", qty: 3, price: 98 }] },
  { receipt: "TXN-00835", datetime: "2026-09-23 10:05 AM", employee: "John Doe", period: "Yesterday",
    items: [{ name: "Silver Swan Soy Sauce", qty: 2, price: 45 }, { name: "Argentina Corned Beef", qty: 3, price: 58 }] },
  { receipt: "TXN-00821", datetime: "2026-09-21 02:30 PM", employee: "Maria Jimenez", period: "This Week",
    items: [{ name: "Rice 5kg", qty: 2, price: 285 }] },
  { receipt: "TXN-00810", datetime: "2026-09-19 05:47 PM", employee: "John Doe", period: "This Week",
    items: [{ name: "Lucky Me Pancit Canton", qty: 10, price: 15.5 }] },
  { receipt: "TXN-00780", datetime: "2026-09-12 01:12 PM", employee: "John Doe", period: "This Month",
    items: [{ name: "Argentina Corned Beef", qty: 4, price: 58 }] },
  { receipt: "TXN-00751", datetime: "2026-09-05 03:33 PM", employee: "Maria Jimenez", period: "This Month",
    items: [{ name: "Datu Puti Vinegar 1L", qty: 2, price: 62 }, { name: "Fresh Milk 1L", qty: 1, price: 98 }] },
  { receipt: "TXN-00699", datetime: "2026-08-14 11:02 AM", employee: "John Doe", period: "All Time",
    items: [{ name: "Silver Swan Soy Sauce", qty: 1, price: 45 }] },
];

const periodInclusion: Record<Period, Period[]> = {
  Today: ["Today"],
  Yesterday: ["Yesterday"],
  "This Week": ["Today", "Yesterday", "This Week"],
  "This Month": ["Today", "Yesterday", "This Week", "This Month"],
  "All Time": ["Today", "Yesterday", "This Week", "This Month", "All Time"],
};

function computeReceipt(r: Receipt, taxRate: number) {
  const qty = r.items.reduce((s, i) => s + i.qty, 0);
  const subtotal = r.items.reduce((s, i) => s + i.qty * i.price, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  return { qty, subtotal, tax, total };
}

// ---------- Component ----------

export default function ReceiptHistory({
  storeName = "9010 Grocery Store",
  laneLabel = "Cashier Terminal · Lane 2",
  cashierName = "John Doe",
  cashierInitials = "JD",
  taxRate = 0.12,
  receipts = defaultReceipts,
}: ReceiptHistoryProps) {
  const navigate = useNavigate();

  const [filter, setFilter] = useState<Period>("Today");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("datetime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);

  const periods: Period[] = ["Today", "Yesterday", "This Week", "This Month", "All Time"];

  const rows = useMemo(() => {
    const included = periodInclusion[filter];
    const withTotals = receipts
      .filter((r) => included.includes(r.period))
      .map((r) => ({ ...r, ...computeReceipt(r, taxRate) }));

    return withTotals.sort((a, b) => {
      let av: string | number = a[sortKey];
      let bv: string | number = b[sortKey];
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = (bv as string).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [receipts, filter, sortKey, sortDir, taxRate]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span className="text-[9px] ml-1 opacity-35">▼</span>;
    return <span className="text-[9px] ml-1 text-[#1E3A2F]">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const selected = rows.find((r) => r.receipt === selectedReceipt);

  const columns: { key: SortKey; label: string; align: "left" | "center" | "right" }[] = [
    { key: "datetime", label: "Date & Time", align: "left" },
    { key: "receipt", label: "Receipt #", align: "left" },
    { key: "employee", label: "Employee", align: "left" },
    { key: "qty", label: "Qty Sold", align: "center" },
    { key: "total", label: "Total", align: "right" },
  ];

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

      {/* Page header */}
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <p className="font-[Space_Grotesk,sans-serif] text-[18px] font-semibold">Receipt History</p>
          <p className="text-[12px] text-[#6B7169]">Look up and review past transactions</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-[#E4E0D6] text-[#6B7169] hover:bg-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Filter + table */}
      <div className="px-8 flex-1">
        <div className="rounded-xl overflow-visible border border-[#E4E0D6] bg-white">
          {/* Filter bar */}
          <div className="px-4 py-3 border-b border-[#E4E0D6] flex items-center justify-between">
            <div className="relative">
              <button
                onClick={() => setFilterMenuOpen((v) => !v)}
                className="flex items-center gap-2 text-[13px] font-semibold px-3 py-2 rounded-lg border border-[#E4E0D6] text-[#16302A]"
              >
                <span>{filter}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {filterMenuOpen && (
                <>
                  {/* Click-outside catcher */}
                  <div className="fixed inset-0 z-10" onClick={() => setFilterMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 w-44 rounded-lg overflow-hidden z-20 bg-white border border-[#E4E0D6] shadow-lg">
                    {periods.map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setFilter(p);
                          setFilterMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-[#F6F4EE]"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <p className="text-[12px] text-[#6B7169]">
              {rows.length} {rows.length === 1 ? "receipt" : "receipts"}
            </p>
          </div>

          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#E7EEE9]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`font-semibold px-4 py-2.5 text-[#16302A] cursor-pointer select-none hover:text-[#1E3A2F] text-${col.align}`}
                  >
                    {col.label}
                    {sortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.receipt}
                  onClick={() => setSelectedReceipt(r.receipt)}
                  className={`cursor-pointer hover:bg-[#E7EEE9] ${idx % 2 === 1 ? "bg-[#FAF8F3]" : ""}`}
                >
                  <td className="px-4 py-2.5">{r.datetime}</td>
                  <td className="px-4 py-2.5 font-medium text-[#16302A]">{r.receipt}</td>
                  <td className="px-4 py-2.5">{r.employee}</td>
                  <td className="px-4 py-2.5 text-center">{r.qty}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">₱{r.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center text-[12px] py-8 text-[#6B7169]">No receipts in this range.</p>
          )}
        </div>
      </div>
      <div className="h-8" />

      {/* Receipt detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-[#1C1E1B]/45 flex items-center justify-center p-6 z-40">
          <div className="w-full max-w-[440px] rounded-2xl p-6 bg-white max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="font-[Space_Grotesk,sans-serif] text-[16px] font-semibold">{selected.receipt}</p>
                <p className="text-[12px] text-[#6B7169]">{selected.datetime} · {selected.employee}</p>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="w-7 h-7 rounded-md flex items-center justify-center border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE] flex-shrink-0"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="rounded-lg overflow-hidden mt-4 border border-[#E4E0D6]">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-[#E7EEE9]">
                    <th className="text-left font-semibold px-3 py-2 text-[#16302A]">Item</th>
                    <th className="text-center font-semibold px-3 py-2 text-[#16302A]">Qty</th>
                    <th className="text-right font-semibold px-3 py-2 text-[#16302A]">Price</th>
                    <th className="text-right font-semibold px-3 py-2 text-[#16302A]">Ext</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item, idx) => (
                    <tr key={idx} className="border-t border-[#E4E0D6]">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 text-center">{item.qty}</td>
                      <td className="px-3 py-2 text-right">₱{item.price.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-semibold">₱{(item.qty * item.price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-1 items-end text-[12.5px]">
              <p className="text-[#6B7169]">Tax ({Math.round(taxRate * 100)}%): ₱{selected.tax.toFixed(2)}</p>
              <p className="font-[Space_Grotesk,sans-serif] text-[18px] font-bold text-[#1E3A2F]">
                Total: ₱{selected.total.toFixed(2)}
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setSelectedReceipt(null)}
                className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]"
              >
                Close
              </button>
              <button
                onClick={() => window.alert("Reprint sent to receipt printer (demo only — not wired to a backend yet)")}
                className="flex-1 text-[13px] font-semibold py-2.5 rounded-lg text-white bg-[#1E3A2F] hover:bg-[#16302A]"
              >
                Reprint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}