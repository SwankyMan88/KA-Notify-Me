# KA Notify Me

A Chrome / Edge extension for Khan Academy with two menus:

- **Chat** — set up a chat room on one of your programs and talk to a buddy
  inside the extension.
- **Notifications** — your KA notifications, checked every 5 seconds, with a
  chime and a count on the toolbar icon.

## How the "auto login" works

You never type credentials into this extension. When you sign in to
khanacademy.org in this browser, Khan Academy sets a session cookie (`KAAS`).
KA Notify Me reads that cookie and uses your existing session to make API calls
on your behalf. That means:

- If you are already signed in, the extension is authenticated the instant you
  install it.
- Signing in or out in any tab takes effect immediately.
- Nothing is ever sent anywhere except khanacademy.org.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

There is no build step — the source loads directly.

## Chat

A chat room is an ordinary **Tips & Thanks comment** on one of your programs.
The messages in the room are that comment's replies, posted through the same
reply API the Notifications menu uses.

**To start one:** *New room*, paste a link to one of your programs, *Create
room*. The extension posts the anchor comment and hands you a code like
`KA-1SURFW8R30G-HTD3PND`.

**To join one:** *Join a room*, paste the code, done. Both of you now see the
same thread with a message bar at the bottom, and each of you shows up in the
other's member list.

Rooms stay in the list, show an unread count, and chime like notifications do.
When a notification is about one of your rooms, it is marked **in chat** in the
Notifications menu and clicking it opens the room instead of sending you to the
website.

### Who can join

Anyone who has the code. There is no approval step and no member list to
enforce — joining just means the extension starts showing you a thread that was
always public. Two consequences worth being clear about:

- Anyone who can *see the program* can read the conversation on khanacademy.org
  and reply to it there, code or not. Their replies show up in the room.
- The **Put the join code in the comment** toggle when creating a room prints
  the code in the anchor comment, so anyone reading the thread can add it to
  their own extension. This leaks nothing new — the code is just the program and
  the room id, and both are already visible to anyone looking at that comment.
  It is off by default because it makes the room easier to stumble into.

### Room ids

Every room gets a six-character id that is **stamped into the text of its anchor
comment**:

> KA Notify Me chat room **HTD3PN** — reply below to join the conversation.

That stamp is what makes the whole thing work:

- **One program can host any number of rooms.** They are separate comments with
  separate ids, and the room list shows the id next to the program name so you
  can tell two rooms on the same program apart.
- **The code stays short.** It carries only the program and the room id — about
  22 characters. When you join, the extension scans the program's Tips & Thanks
  for the matching stamp and gets Khan Academy's (very long) comment key from
  there, instead of hauling it around inside the code.

Codes use an alphabet with no `I`, `L`, `O` or `U`, tolerate lower case and
missing dashes, and carry a check character so a typo is rejected instantly
rather than after a failed lookup.

> **This is not private.** The room is a real comment thread on a real program,
> so anyone can read it on khanacademy.org, and normal Khan Academy moderation
> applies. The code saves your buddy from hunting for the thread — it is not a
> password. Don't put anything in a room you wouldn't post publicly.

### If a room does not appear on the program

Creating a room reads the comment back the same way a joining buddy would.
If it cannot see it, the room is flagged with a warning instead of looking fine.

Two things make Khan Academy silently refuse a post:

- **CSRF.** KA compares the `X-KA-FKey` header against your `fkey` cookie.
  Reads mostly pass without a valid one; writes do not. If the `fkey` cookie is
  missing, open khanacademy.org in a tab once and try again.
- **The low-quality gate.** When KA thinks a post looks low quality it returns
  `lowQualityResponse.showLowQualityNotice` and posts nothing — on the site you
  get a "post anyway?" prompt. The extension answers that prompt and resubmits
  automatically.

**Run a connection check** appears under any error in the Chat menu. It walks
the same path creating a room takes — session cookie, CSRF cookie, profile read,
program link, reading the program's Tips & Thanks — and reports which step
fails. For the full server response, open `chrome://extensions`, find KA Notify
Me, and click **service worker** to get its console.

## Notifications

The list loads more as you scroll to the bottom, a page at a time, up to 400
notifications. *Mark all read* clears the brand-new flag server side, the same
as reading them on the site.

## How it works

| Piece | Job |
| --- | --- |
| `src/background.js` | Service worker: polls, counts unread, paints the badge, triggers the chime, owns all chat actions |
| `src/offscreen/` | Holds the 5s poll timer and plays audio (a service worker can do neither) |
| `src/lib/ka-api.js` | Talks to Khan Academy's GraphQL API |
| `src/lib/chat.js` | Room ids, the comment stamp, short codes, unread maths |
| `src/lib/storage.js` | Wrapper over `chrome.storage.local` |
| `src/popup/` | The two menus |

Three details worth knowing:

**Why an offscreen document.** `chrome.alarms` cannot fire more often than once
per minute, and a Manifest V3 service worker is killed while idle and cannot
play audio. An offscreen document solves all three: it stays alive, runs the
poll `setInterval`, and owns the `<audio>` element. A 1-minute alarm remains as
a safety net that recreates the document if it ever disappears.

The poll runs every **5 seconds**. Your profile is refetched only once a minute,
since a nickname and point total do not change that fast — otherwise the faster
cadence would have doubled the request rate for nothing. If Khan Academy starts
returning HTTP 429, that is rate limiting, and the status bar will say so.

**Why queries are downloaded.** Khan Academy only accepts GraphQL documents it
has safelisted, and it rotates them without warning. Rather than hardcoding
query text that breaks silently, `ka-api.js` looks each operation up by name from
a community mirror of the current safelist and caches it, refetching once on a
400. The five operations used are `getNotificationsForUser`,
`clearBrandNewNotifications`, `getFeedbackReplies` and
`AddFeedbackToDiscussion`, plus `feedbackQuery` to find a room's anchor comment
by its stamp.

**The popup never talks to Khan Academy.** Every request goes through the
service worker; the popup only reads `chrome.storage.local` and re-renders when
it changes. That is what keeps the two menus consistent whether you opened the
popup or a background poll updated things.

## Chime and badge behaviour

The badge counts unread notifications **plus** unread chat messages. The
extension remembers which notification keys and which chat messages it has
already chimed for, so:

- Reloading, restarting the browser, or a failed poll will not re-ring you.
- The first sync after signing in adopts your existing backlog silently.
- Joining a room does not ring for its existing history.

Mute with the bell button in the top bar. Unmuting plays the chime once so you
can hear the level.

## Development

Regenerate the icons and the chime (both are synthesized, no binary assets in
source control):

```bash
node tools/make-assets.mjs
```

Preview the popup in a normal browser tab with fake data — useful for working on
the CSS without reloading the extension:

```bash
node tools/preview-server.mjs
```

Then open <http://localhost:8931/src/popup/preview.html>. `preview-stub.js` fakes
the `chrome.*` APIs, including storage change events and a chat echo, so both
menus are clickable. It is not loaded by the real popup.

## Credit

The approach — session cookie for auth, safelist lookup for GraphQL documents,
and the reply flow the chat is built on — follows
[ka-notifications](https://github.com/eliasmurcray/ka-notifications) by Elias
Murcray (MIT).
