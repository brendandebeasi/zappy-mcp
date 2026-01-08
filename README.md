# zappy-mcp

WhatsApp MCP server for Claude Desktop, OpenCode, and other MCP clients. Send, read, and delete messages with granular per-chat permissions.

Built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and the [Model Context Protocol](https://modelcontextprotocol.io).

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [MCP Setup](#mcp-setup)
- [Permissions](#permissions)
- [Tools](#tools)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
git clone https://github.com/yourname/zappy-mcp.git
cd zappy-mcp
npm install
node src/index.js  # Opens browser with QR code
```

Scan the QR with WhatsApp (Settings > Linked Devices > Link a Device).

## How It Works

This server uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), which runs a headless Chromium browser via Puppeteer to connect to WhatsApp Web. There's no official WhatsApp API for personal accounts, so this library automates the web interface.

### Authentication Flow

1. **First run**: The server launches headless Chromium and opens WhatsApp Web
2. **QR code**: A browser window opens showing a QR code (auto-opens on an available port)
3. **Scan**: Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device -> Scan the QR
4. **Session saved**: After successful scan, session credentials are stored locally
5. **Future runs**: The server reconnects automatically using saved credentials - no QR needed

### Session Storage

```
~/.config/zappy-mcp/
  auth/           # WhatsApp session data (shared across all configs)
```

The auth is stored globally, so you only authenticate once per machine. Different projects can use different permission configs while sharing the same WhatsApp session.

### Re-authenticating

If you need to switch accounts or fix auth issues:

```bash
rm -rf ~/.config/zappy-mcp/auth
node src/index.js  # Opens QR code again
```

### Security Notes

- Session data in `~/.config/zappy-mcp/auth/` grants full access to your WhatsApp - protect it like a password
- The QR code is only shown locally in your browser, never transmitted
- Each config file controls which chats the AI can access - use minimal permissions

## MCP Setup

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zappy-mcp": {
      "command": "node",
      "args": ["/path/to/zappy-mcp/src/index.js", "--config", "/path/to/config.json"]
    }
  }
}
```

### OpenCode

Project-level (`.mcp.json` in project root):

```json
{
  "mcpServers": {
    "zappy-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/zappy-mcp/src/index.js", "--config", ".zappy-mcp.json"]
    }
  }
}
```

User-level (`~/.config/opencode/mcp.json`):

```json
{
  "mcpServers": {
    "zappy-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/zappy-mcp/src/index.js", "--config", "~/.config/zappy-mcp/config.json"]
    }
  }
}
```

## Permissions

By default, **no chats are allowed**. The AI cannot send, read, or delete messages until you explicitly grant access. This is a safety feature - you control exactly which conversations the AI can interact with.

### Finding Chat IDs

First, connect WhatsApp and use the `list_chats` tool to discover your chat IDs:

```
list_chats()              # All chats
list_chats(groupsOnly: true)   # Only groups
```

Chat IDs look like:
- Groups: `120363295812730408@g.us`
- Contacts: `14155551234@c.us` (country code + phone number)

### Config File

Create a config file (e.g., `.zappy-mcp.json`) with the chats you want to allow:

```json
{
  "allowed": [
    {
      "id": "120363295812730408@g.us",
      "name": "Work Group",
      "canSend": true,
      "canRead": true,
      "canDelete": false
    },
    {
      "id": "14155551234@c.us",
      "name": "Alice",
      "canSend": true,
      "canRead": true,
      "canDelete": true
    }
  ]
}
```

### Permission Options

| Field | Description | Default |
|-------|-------------|---------|
| `id` | Chat ID from `list_chats` (required) | - |
| `name` | Human-readable label for your reference | - |
| `canSend` | Allow AI to send messages to this chat | `true` |
| `canRead` | Allow AI to read messages from this chat | `true` |
| `canDelete` | Allow AI to delete its own messages (safety: off by default) | `false` |

### Example Use Cases

| Scenario | canSend | canRead | canDelete |
|----------|---------|---------|-----------|
| Full access | `true` | `true` | `true` |
| Announcements only (no reading) | `true` | `false` | `false` |
| Monitoring only (no sending) | `false` | `true` | `false` |
| Send with ability to unsend mistakes | `true` | `true` | `true` |

### Global Options

At the root level of your config:

```json
{
  "suppressWarnings": true,
  "allowed": [...]
}
```

| Option | Description |
|--------|-------------|
| `suppressWarnings` | Hide "no recipients configured" warnings at startup |

## Tools

### Status & Discovery

| Tool | Description |
|------|-------------|
| `get_status` | Check WhatsApp connection status, shows config path and auth location |
| `list_allowed` | Show all permitted chats with their current permissions |
| `list_chats` | List all WhatsApp chats with IDs - use this to find chat IDs for setup |

### Messaging

#### send_message

Send a message to a chat. Requires `canSend` permission.

| Parameter | Description |
|-----------|-------------|
| `to` | Chat ID (from `list_chats`) or phone number with country code |
| `message` | Text content to send |

#### get_messages

Fetch recent messages from a chat. Requires `canRead` permission.

| Parameter | Description |
|-----------|-------------|
| `chatId` | Chat ID or phone number |
| `limit` | Number of messages to fetch (default: 20) |

#### delete_message

Delete a message you sent. Requires `canDelete` permission. Only works on messages where `fromMe: true`.

| Parameter | Description |
|-----------|-------------|
| `chatId` | Chat ID where the message exists |
| `messageId` | Message ID (get this from `get_messages` response) |
| `forEveryone` | If `true`, deletes for all participants. If `false`, only hides it for you. (default: true) |

## Troubleshooting

### Messages not delivering

The WhatsApp client needs about 5 seconds after connecting to sync with the server. This is handled automatically, but if messages stay stuck in "pending" state, try restarting the MCP server.

### Session/auth issues

If you're having trouble connecting, try clearing the auth data and scanning the QR code again:

```bash
rm -rf ~/.config/zappy-mcp/auth
node src/index.js
```

### Linux: Puppeteer/Chromium dependencies

whatsapp-web.js uses Puppeteer to run headless Chromium. On Linux, you may need to install system dependencies:

```bash
sudo apt-get install -y libgbm-dev libasound2 libatk1.0-0 libcups2 libxss1 libnss3 libgtk-3-0
```

### Account restrictions

WhatsApp does not officially support automation or bots on personal accounts. Excessive or abusive use may result in temporary or permanent account restrictions. Use responsibly and respect rate limits.

## License

MIT
