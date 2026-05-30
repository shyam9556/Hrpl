# Highlight Pro — Solar Business Suite

A full-stack solar quotation management system built for solar installation businesses. Features dealer portal, admin dashboard, CRM, reports, and document management.

## Tech Stack

- **Frontend:** React 19 + Vite 8, Lucide React Icons
- **Backend:** Node.js + Express 5
- **Database:** MySQL 8+
- **Auth:** JWT + bcrypt

## Features

- **Dealer Portal** — Create quotations, manage customers, upload documents
- **Admin Dashboard** — Business metrics, quotation approvals, dealer management
- **Customer CRM** — Lead tracking with status pipeline (Lead → Quoted → Approved → Installed)
- **Price Manager** — Manage solar panels, inverters, and accessories pricing
- **Stock Manager** — Track inventory across categories
- **Reports** — Revenue analytics, dealer performance, customer insights
- **Settings** — Configurable GST rate, quotation numbering, company details
- **Mobile Responsive** — Works on desktop, tablet, and mobile

## Quick Start

### Prerequisites

- Node.js 22+
- MySQL 8+

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd solar-app

   # Frontend dependencies
   npm install

   # Backend dependencies
   cd server
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp server/.env.example server/.env
   # Edit server/.env with your database credentials
   ```

3. **Setup database:**
   ```bash
   # Run the unified MySQL database setup and seeding script (from the root folder)
   npm run db:setup
   ```
   *This command will automatically copy `.env.example` to `.env` (if it doesn't exist), connect to MySQL, create the `highlight_pro` database, apply all sequential migrations, and seed all real solar panel prices, inverter configurations, and 44 pre-packaged kits perfectly.*

4. **Start development servers:**
   ```bash
   # Terminal 1 — Backend
   cd server
   npm run dev

   # Terminal 2 — Frontend
   npm run dev
   ```

5. **Open** `http://localhost:5173`

### Default Admin Login

- **Email:** `admin@highlightpro.in`
- **Password:** `admin@highlightpro`

## Project Structure

```
solar-app/
├── src/                    ← React Frontend
│   ├── components/         ← 13 UI components
│   ├── utils/
│   │   ├── api.js          ← Centralized API client
│   │   ├── constants.js    ← Nav items + initial data
│   │   └── helpers.js      ← PDF generation, calculations
│   ├── App.jsx             ← Root with routing + auth
│   ├── main.jsx
│   └── index.css           ← Full design system (762 lines)
├── server/                 ← Express Backend
│   ├── src/
│   │   ├── routes/         ← 10 route files, 50 endpoints
│   │   ├── middleware/     ← Auth, validation, uploads, errors
│   │   ├── services/       ← Business logic
│   │   ├── validators/     ← Joi schemas
│   │   └── index.js        ← Server entry point
│   ├── migrations/         ← SQL table creation + seed data
│   └── uploads/            ← Document storage
├── .gitignore
├── vite.config.js
└── package.json
```

## API Endpoints (50 total)

| Module | Endpoints | Description |
|--------|-----------|-------------|
| Auth | 7 | Login, register, profile, password management |
| Quotations | 5 | CRUD + status management |
| Customers | 5 | CRM with search and filtering |
| Prices | 11 | Panels, inverters, accessories CRUD |
| Stock | 4 | Inventory management |
| Dealers | 5 | Registration, approval workflow |
| Reports | 4 | Revenue, dealer, customer analytics |
| Settings | 3 | System configuration |
| Uploads | 5 | File upload and management |
| Dashboard | 1 | Combined stats and recent data |

## License

Private — All rights reserved.
