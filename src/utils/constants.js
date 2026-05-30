// ─── INITIAL DATA & NAV CONSTANTS ────────────────────────────────────────────

export const INITIAL_PRICES = {
  panels: [
    { id: "w390", brand: "Waaree", watt: 390, pricePerPanel: 9200, type: "Mono PERC" },
    { id: "w440", brand: "Waaree", watt: 440, pricePerPanel: 10100, type: "Mono PERC" },
    { id: "w545", brand: "Waaree", watt: 545, pricePerPanel: 12400, type: "Bifacial" },
    { id: "a420", brand: "Adani Solar", watt: 420, pricePerPanel: 9800, type: "Mono PERC" },
    { id: "a540", brand: "Adani Solar", watt: 540, pricePerPanel: 12000, type: "Bifacial" },
    { id: "a585", brand: "Adani Solar", watt: 585, pricePerPanel: 13200, type: "TOPCon" },
  ],
  inverters: [
    { id: "g3k", brand: "Growatt", kw: 3, pricePerUnit: 18000, type: "String" },
    { id: "g5k", brand: "Growatt", kw: 5, pricePerUnit: 24000, type: "String" },
    { id: "g10k", brand: "Growatt", kw: 10, pricePerUnit: 42000, type: "String" },
    { id: "h3k", brand: "Havells", kw: 3, pricePerUnit: 20000, type: "String" },
    { id: "h5k", brand: "Havells", kw: 5, pricePerUnit: 27000, type: "String" },
    { id: "h10k", brand: "Havells", kw: 10, pricePerUnit: 46000, type: "String" },
  ],
  accessories: {
    dcWirePerMeter: 45,
    acWirePerMeter: 60,
    earthingKit: 2200,
    mcb: 1200,
    acdb: 3500,
    dcdb: 3200,
    mountingStructurePerKw: 4500,
    lightningArrester: 1800,
    monitoring: 2500,
    installation: 8000,
  },
};

export const INITIAL_STOCK = [
  { id: "s1", category: "Panel", item: "Waaree 390W Mono PERC", qty: 120, unit: "pcs" },
  { id: "s2", category: "Panel", item: "Waaree 440W Mono PERC", qty: 80, unit: "pcs" },
  { id: "s3", category: "Panel", item: "Adani Solar 420W Mono PERC", qty: 60, unit: "pcs" },
  { id: "s4", category: "Panel", item: "Adani Solar 540W Bifacial", qty: 40, unit: "pcs" },
  { id: "s5", category: "Inverter", item: "Growatt 5kW String", qty: 15, unit: "pcs" },
  { id: "s6", category: "Inverter", item: "Growatt 10kW String", qty: 8, unit: "pcs" },
  { id: "s7", category: "Inverter", item: "Havells 5kW String", qty: 10, unit: "pcs" },
  { id: "s8", category: "Wire", item: "DC Solar Cable (4mm)", qty: 2500, unit: "meters" },
  { id: "s9", category: "Wire", item: "AC Cable (Polycab 6mm)", qty: 1800, unit: "meters" },
  { id: "s10", category: "Accessory", item: "Earthing Kit", qty: 30, unit: "pcs" },
  { id: "s11", category: "Accessory", item: "ACDB Box", qty: 20, unit: "pcs" },
  { id: "s12", category: "Accessory", item: "DCDB Box", qty: 20, unit: "pcs" },
];

export const DEALER_NAV = [
  { id: "quote", icon: "filePlus", label: "New Quotation" },
  { id: "requests", icon: "clipboardList", label: "My Requests" },
  { id: "inquiries", icon: "inbox", label: "Inquiries" },
  { id: "customers", icon: "users", label: "Customers" },
];

export const ADMIN_NAV = [
  { id: "dashboard", icon: "layoutDashboard", label: "Dashboard" },
  { id: "requests", icon: "inbox", label: "Quotations" },
  { id: "customers", icon: "users", label: "Customers" },
  { id: "dealer_registrations", icon: "userPlus", label: "Dealer Requests" },
  { id: "dealers", icon: "store", label: "Dealers" },
  { id: "prices", icon: "indianRupee", label: "Price Manager" },
  { id: "stock", icon: "package", label: "Stock Manager" },
  { id: "reports", icon: "barChart3", label: "Reports" },
  { id: "settings", icon: "settings", label: "Settings" },
];
