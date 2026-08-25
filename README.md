# KA Notify Me

A Chrome and Edge extension for Khan Academy. It watches your notifications and
tells you the moment something arrives, and it lets you hold a private-ish chat
with a friend inside the extension.

<br>

## What it does

**Notifications**

- Checks for new notifications every 5 seconds
- Plays a chime and shows a count on the toolbar icon
- Scroll to the bottom of the list to load older ones
- One click to mark everything read

**Chat**

- Turn one of your programs into a chat room
- Get a short code like `KA-1SURFW8R30G-HTD3PND` to send a friend
- They paste the code and you're both in the same conversation
- New messages chime and show an unread count, same as notifications
- A notification about a room opens the room instead of sending you to the site

You never type a password into the extension. If you're signed in to
khanacademy.org in your browser, it picks that session up automatically.

<br>

## Install

### 1. Install Git

Skip this if you already have it. Download it from
[git-scm.com/downloads](https://git-scm.com/downloads) and accept the defaults
during setup.

> **No Git, no problem.** You can instead click the green **Code** button at the
> top of this page, choose **Download ZIP**, and unzip it somewhere permanent.
> Then skip to step 3.

### 2. Clone the repository

Open Command Prompt (press <kbd>Win</kbd>, type `cmd`, hit Enter) and run:

```bash
git clone https://github.com/SwankyMan88/KA-Notify-Me.git
```

That drops a `KA-Notify-Me` folder into wherever the prompt was pointing —
usually `C:\Users\<you>\`.

**Put it somewhere you won't move or delete.** The browser loads the extension
from this folder every time it starts, so if the folder moves, the extension
breaks.

### 3. Turn on Developer mode

Open your browser and go to:

- **Chrome** — `chrome://extensions`
- **Edge** — `edge://extensions`

Flip on **Developer mode**. It's the top-right corner in Chrome, the
bottom-left sidebar in Edge.

### 4. Load the extension

Click **Load unpacked** and select the `KA-Notify-Me` folder — the one
containing `manifest.json`. Don't go into `src`.

The extension appears in your list straight away. There's nothing to build and
nothing to install.

### 5. Pin it

Click the puzzle-piece icon in your toolbar and pin **KA Notify Me** so the
icon and its unread badge stay visible.

### 6. Sign in

If you're already signed in to khanacademy.org, you're done — open the popup
and your notifications are there. If not, the popup gives you a sign-in link.
The extension notices the moment you sign in.

<br>

## Using chat

**To start a room**

1. Open the popup, go to the **Chat** tab
2. Click **New room**
3. Paste a link to one of your Khan Academy programs
4. Give the room a name (optional)
5. Click **Create room**

The extension posts a short comment on that program's Tips & Thanks and hands
you a join code. Send that code to your friend however you like. The name goes
into that comment, so whoever joins sees the same room name.

There's a checkbox to print the join code into the comment itself, so anyone
reading the thread can join. It's off by default.

**To rename a room** — open it, click **⋯**, type a new name, **Rename**.

Note this rename is yours alone. Khan Academy has no way for an extension to
edit a comment once it's posted, so the name written into the anchor comment
when the room was created is fixed. Your friend keeps seeing the original.

**To delete a message** — hover it and click the **×**. It asks once before
committing, since deleting can't be undone. Only your own messages have the
button; Khan Academy refuses anyone else's.

**To join a room**

1. **Chat** tab → **Join a room**
2. Paste the code
3. Click **Join**

Codes ignore capitalisation and stray spaces, and they'll catch a typo before
doing anything.

**To find a code again** — open the room and click the **⋯** button.

<br>

## Heads up: rooms are not private

A room is a real comment thread on a real program. That means:

- Anyone who can see the program can read the whole conversation on
  khanacademy.org, with or without the code
- Anyone can reply there, and their replies show up in the room
- Normal Khan Academy moderation applies

The code makes a room easy to find, not private. **Don't put anything in a room
you wouldn't post publicly.**

<br>

## Chat and the Khan Academy inbox

A chat message is a real comment reply, so Khan Academy generates its own
notification for it. Nothing in its API lets an extension unsubscribe from a
thread, so those notifications cannot be stopped at the source.

What the extension does instead, both on by default in Settings:

- **Hide chat from notifications** keeps them out of the Notifications list,
  since the messages are already in Chat
- **Mark read when opened** clears their "new" flag whenever you open the popup,
  so the count stops building up

They will still be listed on khanacademy.org's own notifications page if you go
looking for them.

<br>

## Updating

The extension checks GitHub every five minutes and shows a banner in the popup
when a newer version is available. **Not now** hides that version until a newer
one appears.

It cannot update itself. An extension loaded this way runs straight off the
folder on your disk, and no extension is allowed to write to that folder or run
git for you — so the banner gives you the command and a **Reload extension**
button for afterwards.

Pull the latest version and reload:

```bash
cd KA-Notify-Me
```

```bash
git pull
```

Then go back to `chrome://extensions` and hit the reload arrow on the KA Notify
Me card.

<br>

## If something goes wrong

**Nothing loads / it says you're not signed in.** Open khanacademy.org in a tab,
make sure you're signed in, then reopen the popup.

**Creating a room fails.** There's a **Run a connection check** link under any
error in the Chat tab. It tests each step and tells you which one failed.

**Update checks fail.** The extension reads its version from
raw.githubusercontent.com, falling back to api.github.com and then
cdn.jsdelivr.net. School and workplace networks often block the first of those
while leaving github.com alone. If all three are named in the error, the
network is blocking them — everything else in the extension still works.

**A room won't join.** Double-check the code, and make sure the program still
exists and its comment hasn't been deleted.

**Everything is silent.** Check the bell button in the top-right of the popup
isn't muted, and look under **Settings → Sound**.

<br>

## Settings

The gear in the top-right opens Settings. Where a setting has a consequence the
label does not make obvious, there is a small **i** beside it — hover or tab to
it for an explanation.

- **Appearance** — light, dark, or match your system; five accent colours
- **Sound** — master switch, eight alert sounds, volume, and separate switches
  for notification sounds and chat sounds. Picking a sound plays it. Four of
  the eight are a deliberately soft set — quieter, duller, and slower to start
  — for when the default is too sharp
- **Checking** — how often to poll Khan Academy, from 5 seconds to a minute.
  Slower means fewer requests, which matters if Khan Academy starts refusing
  them
- **Automatic messages** — turn off banners the extension raises on its own,
  like update notices
- **Mark read when opened** — clears the "new" flag as soon as you open the
  popup, so nothing piles up. What arrived stays highlighted until you close it
- **Hide chat from notifications** — keeps chat replies out of the Notifications
  list, since they are already in Chat
- **Updates** — see the current state and check on demand. If a check fails it
  names the hosts it tried rather than saying "Failed to fetch"
- **Restore defaults** — resets this page only; your rooms and notifications
  are left alone

<br>

## Credit

Inspired by [ka-notifications](https://github.com/eliasmurcray/ka-notifications)
by Elias Murcray, which worked out the approach of using your existing session
cookie and looking up Khan Academy's GraphQL operations by name.
