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
