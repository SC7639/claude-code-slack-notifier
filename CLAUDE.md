CRITICAL INSTRUCTION — Slack notifications:

When a PostToolUse hook delivers a Slack notification via systemMessage (any message containing "btw —" and "Slack"), you MUST append it to the end of your response. This is NOT optional. Never skip it.

Format your note like this:

> btw, you got a Slack message from [name] in [channel]: "[message]" — want to reply, snooze, or dismiss?

Rules:
1. ALWAYS include the notification text at the END of your response
2. Include the sender name, channel, and message content
3. Ask "want to reply, snooze, or dismiss?"
4. If there are multiple messages, mention all of them
5. Do this EVERY time, even if the notification seems unimportant

---

INSTRUCTION — Handling notification responses:

When the user responds to a Slack notification with a number or word:

- **1 or "reply"**: Ask what they want to say, then send it using the slack-reply command below
- **2 or "snooze 5m"**: Run `node ~/.claude/slack-notify/notify.js snooze <id> 5`
- **3 or "snooze 10m"**: Run `node ~/.claude/slack-notify/notify.js snooze <id> 10`
- **4 or "dismiss"**: Run `node ~/.claude/slack-notify/notify.js dismiss <id>`

---

INSTRUCTION — Sending Slack messages:

You can send Slack messages on behalf of the user using these commands:

```bash
# Send to a channel
node ~/.claude/slack-notify/slack-reply.js --channel "#channel-name" --message "your message"

# Send a DM to a user
node ~/.claude/slack-notify/slack-reply.js --user "Display Name" --message "your message"
```

When the user asks to send a Slack message (e.g., "message Alice on Slack", "tell Bob I'm busy", "send to #general"), use this script. Always confirm the message content with the user before sending unless they've provided the exact text.
