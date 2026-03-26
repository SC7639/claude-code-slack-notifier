# Claude Code Slack Notifier

Get Slack notifications delivered directly into your Claude Code session. DMs and @mentions appear inline as you work — reply, snooze, or dismiss without leaving your terminal.

## How it works

1. **`slack-listener.js`** connects to Slack via Socket Mode and watches for DMs and @mentions
2. Messages are queued to a local `.notification-queue.json` file
3. A **PostToolUse hook** (`check-notifications.js`) checks the queue after each tool call and surfaces new messages as system messages in Claude Code
4. A **SessionStart hook** (`check-listener.js`) auto-starts the listener when you launch Claude Code
5. **`slack-reply.js`** lets Claude send replies back to Slack on your behalf

## Quick start

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** and generate an App-Level Token (`xapp-...`)
3. Add these **User Token Scopes** under OAuth & Permissions:
   - `channels:history`, `channels:read`
   - `groups:history`, `groups:read`
   - `im:history`, `im:read`
   - `mpim:history`, `mpim:read`
   - `users:read`
   - `chat:write`
4. Subscribe to these **Events**:
   - `message.channels`, `message.groups`, `message.im`, `message.mpim`
5. Install the app to your workspace and copy the **User OAuth Token** (`xoxp-...`)

### 2. Install

```bash
git clone https://github.com/SC7639/claude-code-slack-notifier.git
cd claude-code-slack-notifier
npm install
```

Create a `.env` file:

```
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_USER_TOKEN=xoxp-your-user-token
```

Run the installer to set up hooks and copy scripts:

```bash
./install.sh
```

This will:
- Copy scripts to `~/.claude/slack-notify/`
- Add PostToolUse and SessionStart hooks to `~/.claude/settings.json`
- Add notification instructions to `~/.claude/CLAUDE.md`

### 3. Start the listener

The listener auto-starts with each Claude Code session. To run it manually:

```bash
node ~/.claude/slack-notify/slack-listener.js
```

## Usage

### Receiving notifications

Notifications appear automatically in your Claude Code session:

> btw — Alice sent you a direct message in DM: "Hey, are you free for a quick sync?"
> 1. Reply  2. Snooze 5m  3. Snooze 10m  4. Dismiss

Respond with a number or word to take action.

### Testing with fake notifications

```bash
# Send a fake DM
~/.claude/slack-notify/slack "Hey!" --from "Alice" --dm

# Send a fake channel message
~/.claude/slack-notify/slack "Check this PR" --from "Bob" --channel "#engineering"

# List pending notifications
~/.claude/slack-notify/slack list

# Clear all notifications
~/.claude/slack-notify/slack clear
```

### Replying from Claude Code

Claude can reply to Slack messages on your behalf using `slack-reply.js`:

```bash
# Reply to a channel
node slack-reply.js --channel "#general" --message "On it!"

# Reply to a DM
node slack-reply.js --user "Alice" --message "Sure, give me 5 min"
```

## Files

| File | Purpose |
|------|---------|
| `slack-listener.js` | Socket Mode listener — queues DMs and @mentions |
| `check-notifications.js` | PostToolUse hook — delivers queued messages to Claude |
| `check-listener.js` | SessionStart hook — auto-starts the listener |
| `slack-reply.js` | Sends replies back to Slack |
| `notify.js` | CLI for managing the notification queue |
| `install.sh` | One-command installer for hooks and scripts |

## License

ISC
