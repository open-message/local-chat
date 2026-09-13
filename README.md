# Local Chat

A free, open-source, peer-to-peer way to meet people nearby.

Live site: <https://open-message.github.io/local-chat/>

Repo: <https://github.com/open-message/local-chat>

## Why this exists (and why it's free)

Love shouldn't be behind a paywall.

Neither should a new friend, a bandmate, a job lead, or the person two ZIP codes over who happens to be looking for the same thing you are. Too many apps that help people meet are businesses first: they rent you access to a crowd they own, then spend that rent on ads, boosts, and engagement tricks. True connection shouldn't have financial incentives dictating how people live their best life.

Local Chat is open source, and it is built as a mesh. Your browser talks to other people's browsers. There is no Local Chat company server, no warehouse of profiles, no monthly bill for keeping "the platform" alive. Take away the ongoing infrastructure cost, and the project stays financially independent of any single controlling company.

By removing the cost to maintain, we can remove the cost to use. By removing the financial incentive, this app can actually focus on the good of the user. Privacy, safety, and happiness come first — not conversion, not retention, not a premium tier that unlocks the people who were already nearby.

## What it is

A **static** web app with **no Local Chat backend**. Profiles live in your browser, or in the optional [desktop vault](desktop/README.md). Discovery is **online-only**: each time the app loads it takes a GPS fix, finds US ZIP codes within your distance setting, and shows people who currently have the app open in those ZIP rooms. Matching, privacy, and chat stay in the browser. GPS is not sent to a geocoder.

Browsers find each other through the public [PeerJS cloud](https://peerjs.com/) signaling service plus WebRTC. That is not a Local Chat server, but it is still a third party.

## How it works

1. You confirm you are 18+ (self-declared date of birth) and share a location. A GPS-enabled browser is required; the app uses that GPS fix as the source of truth.
2. The app matches that fix to nearby US ZIP codes (from a static dataset) inside your distance setting, then joins those ZIP rooms over PeerJS. The ZIP polygon that contains your GPS is hosted when possible; other nearby ZIP centroids inside the radius are joined as a client.
3. People currently in those rooms appear in a stack. You only see people whose looking-for overlaps yours (relationships, friendships, networking, join a band, find musicians). ZIP defaults to **Me**. Distance filters use GPS when the other person shares Geo location. With Precise location off, they share no coordinates, and distances under 2 miles are unavailable. With Precise location on, a separate Geo location lock (default **Me**) controls who gets GPS. If they already asked to connect, you see **They asked to connect!** Handles default to hidden until you both connect.
4. **Ask to connect** is one-way until they connect back. **Add as friend** then saves you on each other's devices so the profile is still there after they go offline. Either person can remove the friendship.
5. **Chat** is the messaging tab. It lists 1:1 conversations that still have messages (expired history drops off) and live groups you belong to. Start a new 1:1 from Friends. **New group** makes a live friend group: private (only you invite) or public (any member can invite their friends). Groups are never listed on Online. Group messages go to members who have the app open; anyone who was away misses them. After you send, **Undo** takes that message back if nobody has opened the thread yet and puts the text in the box so you can edit and send again. Once someone has viewed it, undo goes away. **Keep messages** (end of session, 1 hour, 6 hours, 24 hours, 1 week, 1 month, or never) is per conversation. For 1:1 chats it updates for both people. For private groups it stays on this device. For public groups, only the creator sets it, and it applies to every member when they next connect. **Clear** next to a conversation, or on a 1:1 thread, wipes that thread on both devices when they next connect. **Clear** on a private group wipes the thread for every member when they next connect. On a public group, only the creator can clear or change Keep messages (other members do not see those controls). New chats default to 6 hours. Older saved threads keep **Never** until you change them.
6. The **QR** button in the top-right shares a link to you. Scanning it opens your chat if you are already friends, or your profile so they can add you. Direct chats use a room id hashed from both user ids.
7. You start **offline**. Settings has an **Online** switch, off by default, so the app does not join nearby ZIP rooms until you turn it on. While it is off you disappear from Online, you cannot browse people who are online, and you can only see and message friends. Friends has a **Go online** button. **Precise location** is also off by default: others who can see ZIP get the ZIP code, not coordinates, and the distance control cannot go below 2 miles. Turn it on to use 1, 0.5, or 0.25 mile, and to choose who can see this GPS fix with a Geo location lock on You.

The same identity can be online on more than one device. Each install uses its own PeerJS connection id. Other people still see one person. Create and switch profiles at the top of **You**. An optional [ElectroBun desktop vault](desktop/README.md) is a connector: it stores identities on disk, links browsers with a QR code, and two-way merges every identity while the hub is open. A linked device receives every identity in the vault (the private keys included). Opening the chat site without `?link=` does not link the device.

### Profiles

On **You**, you choose what you are looking for and who can see each part of your profile. Every field has a lock:

- **Public** — people nearby, before you connect
- **Connections** — after you both connect
- **Friends** — people you have added as friends
- **Me** — only you

Looking-for types default to public so people nearby can match with you. ZIP defaults to **Me**. Precise location in Settings is off by default (no coordinates shared). When you turn it on, You shows a Geo location lock, also default **Me**. You can lock any field, and preview each audience on You before anyone else sees it.

Optional profile sections include YouTube, YouTube Music, GitHub, SoundCloud, Bandcamp, and LinkedIn. Those stay behind the same locks; opening a player or link still loads that site in the other person's browser.

Filters (top-right on Online) let you narrow the stack by people (all, connects only, friends only), looking-for, age, and distance, and change how heavily shared interests affect ranking.

## Honest limitations

- Age and GPS can be spoofed. We cannot verify either without a backend.
- You will not see people who are not online right now.
- Some networks (strict NATs, locked-down Wi‑Fi) fail without TURN. We do not run TURN.
- Anyone who can see a photo or profile text can screenshot it.
- Google Analytics 4, if a measurement ID is configured, runs in the browser. Google will see IP address, user agent, and coarse usage events. We do not send handles, photos, peer IDs, GPS, ZIP, or date of birth to Analytics.
- Clearing site data deletes a browser-only identity. Link the browser to Local Chat desktop, or keep an encrypted vault export, if you need it to survive that.
- Your identity is a key. Anyone who has that key (this browser, a linked phone, the desktop vault, or an encrypted export plus passphrase) can be you. A linked device receives every identity in the vault. Occupying your PeerJS id without the key is not enough to impersonate you.

## Local development

This app has **no build step**. From the repo root:

```bash
make local
```

That is `python3 scripts/serve.py 4173`. Open <http://localhost:4173/>. Two identities on one computer: use You → + New, a normal window and an incognito window, or `?slot=a` and `?slot=b` (separate localStorage keys). Slots only isolate storage — the two tabs still find each other through ZIP rooms, so both need **Online** on and overlapping looking-for types (public by default). Localhost (and any host other than `open-message.github.io`) uses a separate PeerJS ZIP-room namespace from the [live site](https://open-message.github.io/local-chat/), so development does not join or host production rooms. QR codes use `https://<hostname>.local:4174/` so a phone on the LAN gets a secure context (WebRTC). Accept the certificate warning once, or trust `.dev-certs/cert.pem`.

Desktop vault (Hutch CLI, from the repo root — not a bare `hutch electrobun sync` here):

```bash
make hutch      # once: install the ElectroBun CLI
make desktop    # sync SDK in desktop/, then open the app
```

`make desktop` needs a graphical session. It will not open windows from a Cursor remote or plain SSH terminal. Reconnect with `ssh -Y` from a machine that already has an X server, or run it on a logged-in desktop.

Point the vault **Chat site** at `http://localhost:4173/` while developing. `make` lists every target.

GitHub Pages is served from `/local-chat/`. Relative URLs are used so the same files work at the site root locally and at `/local-chat/` in production.

ZIP centroids and per-state polygons in `data/` can be rebuilt with `make zcta`. You do not need to run that to develop.

## Desktop vault

The live website does not offer import/export. The [ElectroBun app](desktop/README.md) is a hub plus encrypted backup: it stores identities on disk, links browsers with a QR code, and two-way merges every identity onto linked devices. Scanning that code opens this site with `?link=` so the desktop can authorize the device. Opening the chat site without `?link=` does not link the device.

## License

MIT. See [LICENSE](LICENSE). Privacy notes: [PRIVACY.md](PRIVACY.md).
