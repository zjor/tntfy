---
created: 2026-05-08
status: active
tags: [guide, publishing, http-api]
---

# Publishing messages

How to send notifications to a Telegram topic over HTTP. Once you have a topic and its bearer token (created with `/create <name>` in the bot), every example below is a single `curl`.

The publish endpoint is content-type-driven: `Content-Type` decides whether the body is plain text, Markdown, HTML, an image, or an arbitrary file. The topic name is automatically prepended to every delivered message — bolded for Markdown/HTML, bracketed (`[topic]`) for plain text and image/file captions.

## Setup

Set these once per shell. Replace with your own host, token, and topic name.

```bash
export TNTFY_HOST=http://localhost:3000
export TNTFY_TOKEN=tk_xxxxxxxxxxxxxxxxxxxxxxxx
export TNTFY_TOPIC=deploys
```

## Plain text

`Content-Type: text/plain` — simplest case. Topic appears as `[deploys]` above the body.

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "Backup completed at $(date)"
```

`curl -d "..."` defaults to `application/x-www-form-urlencoded`, which the server treats as plain text — convenient for one-liners:

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -d "Quick one-liner notification"
```

## Markdown

`Content-Type: text/markdown` is sent to Telegram with `parse_mode=MarkdownV2`. The topic is bolded as `*deploys*`.

MarkdownV2 reserves `_*[]()~` `` ` `` `>#+-=|{}.!\` — escape with `\` if you want them literal in your body.

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -H "Content-Type: text/markdown" \
  --data $'*Deploy succeeded*\n_Service:_ api\n`commit: 3e9c9f2`\n[view logs](https://example.com/logs)'
```

## HTML

`Content-Type: text/html` is sent with `parse_mode=HTML`. The topic is bolded as `<b>deploys</b>`.

Telegram only accepts a small tag set: `b`, `i`, `u`, `s`, `code`, `pre`, `a`, plus a few span variants. Anything else is rejected by Telegram and surfaces as `502 telegram_failed`.

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -H "Content-Type: text/html" \
  --data '<b>Deploy succeeded</b>
<i>Service:</i> api
<code>commit: 3e9c9f2</code>
<a href="https://example.com/logs">view logs</a>'
```

## Image

Any `image/*` content type is forwarded via `sendPhoto`. The topic becomes the caption (`[deploys]`); if you supply a `Caption` header, it's appended on the next line.

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -H "Content-Type: image/png" \
  -H "Filename: screenshot.png" \
  -H "Caption: nightly run failed" \
  --data-binary @./screenshot.png
```

## File

`application/octet-stream`, `audio/*`, and `video/*` are forwarded via `sendDocument`. Same caption and filename rules as image.

```bash
curl -X POST "$TNTFY_HOST/v1/publish/$TNTFY_TOPIC" \
  -H "Authorization: Bearer $TNTFY_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  -H "Filename: report.pdf" \
  -H "Caption: Q2 report" \
  --data-binary @./report.pdf
```

## Headers

| Header | Required | Notes |
|---|---|---|
| `Authorization: Bearer <token>` | yes | Topic-scoped token from the bot's `/create` reply. |
| `Content-Type` | yes | Drives format selection. See limits below. |
| `Filename` | no | Suggested filename for image/file. If omitted, the server generates one. |
| `Caption` | no | Caption text for image/file. Topic is always prepended. |

## Limits

| Format | Max size | Failure |
|---|---|---|
| Text (any of plain / Markdown / HTML) | 4096 chars after topic prefix | `413 payload_too_large` |
| Image | 10 MB | `413 payload_too_large` |
| File | 50 MB | `413 payload_too_large` |
| Caption (image/file) | 1024 chars after topic prefix | `413 payload_too_large` |

## Errors

| HTTP | Body | When |
|---|---|---|
| `200` | `{ id, telegram_message_id, topic, delivered_at }` | Delivered. |
| `400` | `{ error: "empty_body" }` | Empty text body. |
| `400` | `{ error: "unsupported_content_type" }` | Content-Type not in the supported set. |
| `401` | `{ error: "missing_token" }` / `invalid_token` | Bad or missing `Authorization`. |
| `404` | `{ error: "topic_not_found" }` | Path topic doesn't match the token's topic, or topic was deleted. |
| `413` | `{ error: "payload_too_large" }` | Exceeds limit above. |
| `502` | `{ error: "telegram_blocked" / "telegram_throttled" / "telegram_failed" }` | Telegram rejected the send (user blocked the bot, rate-limited, or other API error). |
