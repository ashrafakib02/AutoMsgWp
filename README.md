# AutoMsgWp — WhatsApp Vehicle Dispatch Bot

An automated WhatsApp bot that listens for delivery request messages in allowed WhatsApp groups and replies with the next available vehicle number, prioritized from an Excel spreadsheet. Includes a web dashboard for managing the vehicle list, monitoring bot status, and viewing activity logs.

## How It Works

```
WhatsApp Group Message
        │
        ▼
  ┌─────────────┐    keyword-score    ┌──────────────┐
  │  Baileys     │───────────────────▶│  Parser       │
  │  (WhatsApp)  │   is delivery msg? │  (3 keywords) │
  └──────┬──────┘                     └──────────────┘
         │ yes
         ▼
  ┌─────────────┐   priority sort    ┌──────────────┐
  │  Excel       │──────────────────▶│  Reply with   │
  │  Manager     │  next available   │  vehicle #    │
  └─────────────┘                    └──────────────┘
```

1. A message arrives in an allowed WhatsApp group
2. The **parser** checks if it looks like a delivery request (must match ≥3 delivery-related keywords like `dealer`, `zone`, `code`, `delivery`, etc.)
3. If matched, the **Excel manager** picks the highest-priority available vehicle (`isAccepted = false`)
4. The bot replies in the group with the vehicle number and marks it as dispatched in the spreadsheet
5. Old dispatched entries are automatically archived to a separate file after 1 hour

## Tech Stack

| Layer | Technology |
|-------|-----------|
| WhatsApp API | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) |
| Server | Express 5 (Node.js) |
| Data Store | Excel (`.xlsx`) via `xlsx` library |
| File Watching | `chokidar` — hot-reloads the spreadsheet when edited externally |
| Background I/O | `worker_threads` — disk writes happen off the main event loop |
| Dashboard | Vanilla HTML/CSS/JS single-page app |

## Project Structure

```
autoMsgWp/
├── index.js                 # WhatsApp bot — connection, message handling, admin commands
├── server.js                # Express server — dashboard, auth, REST API for CRUD
├── excelManager.js          # Excel read/write, priority sorting, archiving, file watcher
├── excelWriter.worker.js    # Worker thread for non-blocking disk writes
├── parser.js                # Keyword-score message parser (delivery detection)
├── config.js                # Allowed groups & admin JID (from env)
├── logger.js                # In-memory event log (last 100 entries)
├── state.js                 # Shared bot state (connection status, on/off toggle)
├── public/
│   ├── index.html           # Dashboard SPA (vehicles, logs, QR code, auth)
│   └── index2.html
├── .env                     # Environment variables (gitignored)
├── .gitignore
└── package.json
```

## Prerequisites

- **Node.js** ≥ 18
- **npm**
- A WhatsApp account (the bot links as a "Linked Device")
- A VPS or local machine to run the bot 24/7 (tested on Ubuntu with PM2)

## Setup

### 1. Clone & install

```bash
git clone https://github.com/ashrafakib02/AutoMsgWp.git
cd AutoMsgWp
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
ADMIN_JID=<your-whatsapp-jid>@lid        # Your WhatsApp JID (admin)
ALLOWED_GROUP=<group-jid>@g.us           # WhatsApp group to monitor
DASHBOARD_KEY=<your-dashboard-password>  # Password for the web dashboard
```

> **How to find your JID:** Start the bot once, check the logs for your phone number connected message, or use the admin `+` command in the group.

### 3. Run

```bash
# Development
npm start

# Production (recommended)
pm2 start server.js --name delivery-bot
```

The bot and dashboard start together on **port 3000**. Open `http://localhost:3000` to access the dashboard.

### 4. Link WhatsApp

1. The dashboard will show a QR code on first launch
2. Open WhatsApp → **Linked Devices** → **Link a Device**
3. Scan the QR code
4. The bot is now connected and listening in the allowed group

## Dashboard

The web dashboard (password-protected) provides:

| Feature | Description |
|---------|-------------|
| **QR Code Display** | Scan to link/unlink WhatsApp |
| **Vehicle Management** | Add, edit, delete, toggle status of vehicles — inline editing supported |
| **Activity Log** | Recent dispatches with timestamps, delay metrics, and vehicle assignments |
| **Bot Toggle** | Pause/resume the bot without restarting |
| **Sign Out** | Disconnect WhatsApp session (with option to unlink) |

The vehicle list auto-refreshes every 3 seconds. The Excel file is hot-reloaded when edited externally.

## Excel File Format

Each phone number gets its own spreadsheet: `vehicle_list_<phone>.xlsx`

| Column | Type | Description |
|--------|------|-------------|
| `vehicle_number` | string | Unique vehicle identifier |
| `isAccepted` | boolean | `false` = available, `true` = already dispatched |
| `Priority` | number | Lower number = dispatched first |
| `Remarks` | string | Optional notes |
| `dispatchedAt` | string | ISO timestamp of when the vehicle was dispatched |

## Admin Commands

Send these messages in the allowed WhatsApp group:

| Command | Description |
|---------|-------------|
| `/status` | Check if the bot is ON or OFF |
| `/pause` | Pause the bot (stops responding to delivery messages) |
| `/resume` | Resume the bot |
| `/reload` | Reload the Excel spreadsheet from disk |

## REST API

All API endpoints (except login) require session authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Bot connection status |
| `GET` | `/api/logs` | Recent dispatch logs |
| `POST` | `/api/bot/toggle` | Pause/resume the bot |
| `GET` | `/api/rows` | List all vehicles |
| `POST` | `/api/rows` | Add a new vehicle |
| `PATCH` | `/api/rows/:index` | Update a vehicle |
| `DELETE` | `/api/rows/:index` | Delete a vehicle |

## Key Behaviors

- **Priority dispatch**: Vehicles are dispatched in ascending `Priority` order; lower number = higher priority
- **Auto-archive**: Dispatched vehicles older than 1 hour are moved to `vehicle_list_<phone>_archive.xlsx` every 30 minutes, keeping the live sheet small
- **Background writes**: All Excel writes run in a worker thread with 1.5s debounce — burst dispatches collapse into a single write
- **Sender-key pre-warm**: On connect, the bot sends and immediately deletes a message to each group to pre-negotiate sender keys, so the first real reply is fast
- **Auto-reconnect**: On disconnection, the bot automatically reconnects after 3 seconds (unless logged out)

## Deployment (VPS)

```bash
# Upload files
scp *.js *.json .env root@<your-vps>:/root/autoMsgWp/

# SSH and restart
ssh root@<your-vps>
cd /root/autoMsgWp
pm2 restart delivery-bot

# Check logs
pm2 logs delivery-bot --lines 20
```

### Re-linking to a Different WhatsApp Number

```bash
pm2 stop delivery-bot
rm -rf auth/
pm2 restart delivery-bot
# Scan the new QR code from the dashboard
```

## License

ISC
