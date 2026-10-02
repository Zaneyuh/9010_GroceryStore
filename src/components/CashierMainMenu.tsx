import { useNavigate } from "react-router-dom";

// ---------- Types ----------

interface ModuleTile {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: number;
  onClick?: () => void;
}

type AlertKind = "stock" | "request" | "system";

interface AlertItem {
  id: string;
  kind: AlertKind;
  label: string;
  title: string;
  detail: string;
}

type RailItemId = "dashboard" | "settings";

interface CashierMainMenuProps {
  storeName?: string;
  laneLabel?: string;
  cashierName?: string;
  cashierInitials?: string;
  alerts?: AlertItem[];
  activeRailItem?: RailItemId;
  onRailNavigate?: (item: RailItemId) => void;
  onLogout?: () => void;
  onViewAllAlerts?: () => void;
}

// ---------- Icons ----------

const railIcons: Record<RailItemId, React.ReactNode> = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
};

const icons = {
  sale: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  ),
  refund: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
    </svg>
  ),
  receipt: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l3 3v17l-3-2-2.5 2-2.5-2-2.5 2-2.5-2-3 2V5a3 3 0 0 1 3-3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  ),
  inventory: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
    </svg>
  ),
  requests: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  ),
  settings: railIcons.settings,
};

// ---------- Default mock data ----------

const defaultAlerts: AlertItem[] = [
  { id: "a1", kind: "stock", label: "Low stock", title: "Datu Puti Vinegar 1L", detail: "6 units left · reorder point 10" },
  { id: "a2", kind: "stock", label: "Near expiry", title: "Fresh Milk 1L (x8)", detail: "Expires in 2 days" },
  { id: "a3", kind: "request", label: "Customer request", title: "Silver Swan Soy Sauce, 1 gal", detail: "Requested 20 min ago" },
  { id: "a4", kind: "system", label: "System", title: "Shift reminder", detail: "Cash count due at 2:00 PM" },
];

const alertAccent: Record<AlertKind, string> = {
  stock: "border-l-[#E8862E]",
  request: "border-l-[#1E3A2F]",
  system: "border-l-[#6B7169]",
};

const alertLabelColor: Record<AlertKind, string> = {
  stock: "text-[#C96E1E]",
  request: "text-[#1E3A2F]",
  system: "text-[#6B7169]",
};

// ---------- Component ----------

export default function CashierMainMenu({
  storeName = "9010 Grocery Store",
  laneLabel = "Cashier Terminal · Lane 2",
  cashierName = "John Doe",
  cashierInitials = "JD",
  alerts = defaultAlerts,
  activeRailItem = "dashboard",
  onRailNavigate,
  onLogout,
  onViewAllAlerts,
}: CashierMainMenuProps) {
  const navigate = useNavigate();

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const railItems: { id: RailItemId; title: string }[] = [
    { id: "dashboard", title: "Dashboard" },
    { id: "settings", title: "Settings" },
  ];

  function handleRailClick(id: RailItemId) {
    onRailNavigate?.(id);
  }

  const tiles: ModuleTile[] = [
    { id: "sale", label: "Make a Sale", description: "Scan items, checkout", icon: icons.sale, onClick: () => navigate("/make-a-sale") },
    { id: "refund", label: "Return & Refund", description: "Process a return", icon: icons.refund, onClick: () => navigate("/return-refund") },
    { id: "receipts", label: "Receipt History", description: "Look up past sales", icon: icons.receipt, onClick: () => navigate("/receipt-history") },
    { id: "inventory", label: "Inventory", description: "Check stock on hand", icon: icons.inventory },
    { id: "requests", label: "Item Requests", description: "Log what customers want", icon: icons.requests, badge: 2 },
    { id: "settings", label: "Settings", description: "Terminal preferences", icon: icons.settings },
  ];

  return (
    <div className="min-h-screen flex bg-[#F6F4EE] text-[#1C1E1B] font-[Manrope,sans-serif]">
      {/* Left icon rail — intentionally minimal: cashiers only get Dashboard + Settings,
          matching the RBAC restriction in the SRS (no inventory/admin/report access) */}
      <aside className="w-[72px] flex-shrink-0 flex flex-col items-center py-5 gap-1 bg-[#1E3A2F]">
        <div className="w-9 h-9 rounded-md flex items-center justify-center mb-6 bg-[#E8862E]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6A1 1 0 0 0 5.6 19H17" />
            <circle cx="9" cy="21" r="1" /><circle cx="17" cy="21" r="1" />
          </svg>
        </div>

        {railItems.map((item) => (
          <button
            key={item.id}
            title={item.title}
            onClick={() => handleRailClick(item.id)}
            className={`relative w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
              activeRailItem === item.id ? "text-white" : "text-white/55 hover:text-white/90"
            }`}
          >
            {activeRailItem === item.id && (
              <span className="absolute -left-[12px] w-1 h-5 rounded-r-full bg-[#E8862E]" />
            )}
            {railIcons[item.id]}
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-[#E8862E]">
            {cashierInitials}
          </div>
          <button onClick={onLogout} title="Log out" className="w-9 h-9 rounded-lg flex items-center justify-center text-white/55 hover:text-white/90">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-[#E4E0D6] bg-white">
          <div>
            <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold leading-tight">{storeName}</p>
            <p className="text-[12px] text-[#6B7169]">{laneLabel}</p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right hidden sm:block">
              <p className="text-[13px] font-semibold">{time}</p>
              <p className="text-[11px] text-[#6B7169]">{date}</p>
            </div>
            <div className="flex items-center gap-2 pl-4 border-l border-[#E4E0D6]">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white bg-[#E8862E]">
                {cashierInitials}
              </div>
              <div className="hidden md:block">
                <p className="text-[13px] font-semibold leading-tight">{cashierName}</p>
                <p className="text-[11px] text-[#6B7169]">Cashier</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-[12px] font-semibold px-3 py-2 rounded-md border border-[#E4E0D6] text-[#6B7169] hover:bg-[#F6F4EE]"
            >
              Log Out
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6 lg:p-8">
          {/* Modules grid */}
          <section className="flex-1">
            <div className="flex items-baseline justify-between mb-5">
              <h1 className="font-[Space_Grotesk,sans-serif] text-[22px] font-semibold">
                Good day, {cashierName.split(" ")[0]}
              </h1>
              <p className="text-[13px] text-[#6B7169]">{tiles.length} modules available</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  onClick={tile.onClick}
                  className="relative text-left bg-white border border-[#E4E0D6] border-b-4 rounded-xl p-5 flex flex-col items-start gap-4
                             transition-transform duration-150 ease-out
                             hover:-translate-y-0.5 hover:border-b-[#1E3A2F]
                             active:translate-y-px active:border-b-2"
                >
                  {tile.badge != null && (
                    <span className="absolute top-4 right-4 text-[10px] font-bold px-2 py-0.5 rounded-full text-white bg-[#E8862E]">
                      {tile.badge}
                    </span>
                  )}
                  <div className="text-[#1E3A2F]">{tile.icon}</div>
                  <div>
                    <p className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold">{tile.label}</p>
                    <p className="text-[12px] mt-0.5 text-[#6B7169]">{tile.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Alerts & Notifications panel */}
          <aside className="w-full lg:w-[320px] flex-shrink-0">
            <div className="rounded-xl h-full flex flex-col bg-white border border-[#E4E0D6]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E0D6]">
                <h2 className="font-[Space_Grotesk,sans-serif] text-[15px] font-semibold">Alerts &amp; Notifications</h2>
                <span className="w-2 h-2 rounded-full bg-[#E8862E] animate-pulse" />
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {alerts.map((alert) => (
                  <div key={alert.id} className={`rounded-lg p-3.5 bg-white border-l-[3px] ${alertAccent[alert.kind]}`}>
                    <p className={`text-[12px] font-bold uppercase tracking-wide ${alertLabelColor[alert.kind]}`}>
                      {alert.label}
                    </p>
                    <p className="text-[13px] font-semibold mt-1">{alert.title}</p>
                    <p className="text-[12px] mt-0.5 text-[#6B7169]">{alert.detail}</p>
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-[#E4E0D6] text-center">
                <button onClick={onViewAllAlerts} className="text-[12px] font-semibold text-[#1E3A2F]">
                  View all notifications
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}