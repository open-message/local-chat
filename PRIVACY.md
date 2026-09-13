# Privacy and safety

Local Chat is a static app. **We do not operate a profile database, chat server, or location server.** What you type and the photo you add are stored in **this browser** (or, if you use the optional desktop app, in files on that computer) and, while you are online, sent over WebRTC to other people in nearby ZIP rooms (chosen from your current GPS fix plus your distance setting) and to people you match with. Chat transcripts use durable storage only when you choose a keep-messages setting other than end of session.

## What other people in a room can see

While you are connected, peers receive a **public profile**: photo, age (not date of birth), gender, what you are looking for (relationships, friendships, networking, and music), interests, deal breakers, hobbies, questionnaire answers, and an **approximate** location rounded to about one mile. Your chosen handle is hidden until both people mark Interested. If someone marked Interested in you, you can see that on their stack card before you match.

If you add a YouTube channel and open that lock, that audience can see the videos you selected for your profile. Opening a player loads YouTube in their browser.

If you add a YouTube Music playlist and open that lock, that audience can see that playlist. Opening the player loads YouTube in their browser.

If you add GitHub and open that lock, that audience can see the public repos you selected (and the GitHub name, bio, avatar, and README thumbnail loaded with them). Opening those links or images loads GitHub.

If you add SoundCloud or Bandcamp and open that lock, that audience can see the tracks, playlists, or releases you selected. Opening a player loads SoundCloud or Bandcamp in their browser.

If you add LinkedIn and open that lock, that audience can see the LinkedIn fields you selected (profile link, and any photo, name, headline, roles, schools, or projects you chose). Opening those fields may load LinkedIn or its image CDN in their browser. A LinkedIn data archive you import is read in this browser only; we do not keep address, birthday, email, or phone from that file.

Treat that as public. Screenshots are always possible.

The QR code and share link include your peer ID. Anyone who has that link can try to open your profile while you have the app open. Friend chat is sent over WebRTC to that person. There is no chat server. Connecting still requires a signed handshake: knowing the id is not enough to impersonate you without the private key stored in this browser, on a linked device, or in a desktop vault.

Chat history stays on this device (and on linked devices after they sync). **Keep messages** is chosen in the Chat tab per conversation and is synced to the other person: end of session (this browser tab, including refresh), a time limit, or never (still capped). Timed history is dropped when it is older than the limit. **Clear** removes the thread here immediately; the other device is cleared when they next connect. We cannot erase a copy they already screenshotted or saved by other means.

The same identity can appear from more than one of your devices at once. Other people still see one person. Each of your devices uses a separate PeerJS connection id, bound to your identity key.

## Location precision

Distance filters (including 1, 0.5, and 0.25 mile) use the **already rounded** coordinates other people send. They do not receive a more precise GPS fix. The ZIP shown for you is the Census ZCTA polygon that contains your GPS (nearest ZIP centroid if the point sits in a gap). Nearby ZIP rooms are the other centroids inside your distance setting (capped so a dense metro does not open dozens of connections). Polygon shards load in this browser only; GPS is not sent to a geocoder. A radius like 100 feet would only be meaningful if we shared much more exact coordinates, which could identify a home, workplace, or other precise spot. We do not share location at that precision.

## What we cannot do

- We cannot verify age. 18+ is self-declared.
- We cannot verify GPS. Location is whatever this device reports.
- We cannot remove a copy of your profile from someone else’s device after they received it.
- We cannot restore a browser-only identity after you clear site data. Use Local Chat desktop, or an encrypted vault export, if you need a copy that survives that.

## Identity

Each identity is an ECDSA P-256 keypair. In the website it is stored in **localStorage** on this origin (`https://open-message.github.io` for the live site). Other pages on that same origin can read it. A script running on this origin (XSS) can use it. Clearing site data deletes it. The public half and signatures are sent to peers; the private key is not.

The optional desktop app stores that key in files on your computer and can copy it to other browsers you authorize. Encrypted vault export wraps every identity in the vault with a passphrase. Anyone with the passphrase and that file can be those identities.

The live website does not offer plaintext import/export. Scan a QR from Local Chat desktop to link a browser. Unlink keeps the local copy and stops sync.

Each install also has a **device key**. ZIP presence includes a device id signed by your identity key so other clients can reach this process without occupying the same PeerJS id as your other devices. The desktop (or an unlinked browser) may also occupy the legacy identity PeerJS id so older clients can still connect.

## Third parties

- **PeerJS cloud** (`0.peerjs.com`) introduces browsers so WebRTC can start. They may see connection metadata (IP, peer IDs, timing), including device-scoped ids and the desktop vault hub id. ZIP room IDs are scoped to the site origin: the live GitHub Pages app does not share rooms with localhost or copies on other domains. Room IDs are still public and guessable; a modified client can point at them.
- **Google Analytics 4** loads only if a measurement ID is set in `js/config.js`. Events are funnel names only (for example `match`, `zone_join` with `level=zip` and a count). No handles, photos, peer IDs, coordinates, ZIP codes, or dates of birth are sent as event parameters. Google still receives typical browser telemetry (including IP).
- **unpkg** (or similar CDN) may serve the PeerJS library.
- **YouTube** loads when you open a channel on the You tab (the public uploads list, up to 200 videos) and when someone opens an embedded video on a profile. We use YouTube’s player and privacy-enhanced embed host (`youtube-nocookie.com`). Google may still see IP address and watch data. @handles are not resolved; only public channel IDs (`UC…`) and the video IDs you select are stored and shared.
- **YouTube Music** uses the same YouTube player for a public playlist or album you paste (`list=PL…` or `OLAK5uy…`). Generated mixes and private playlists are not loaded. Opening the player still goes to Google.
- **GitHub** loads when you enter a username on the You tab (public profile and public repos, via `api.github.com`, about 60 unauthenticated requests per hour). We also read public `README.md` files from `raw.githubusercontent.com` to pick a thumbnail if the README has an image. We store the username, name, bio, avatar URL, the repos you selected, and those thumbnail URLs. We do not request GitHub email. Opening a repo, avatar, or thumbnail loads GitHub.
- **SoundCloud** loads when you add a public track, playlist, or profile URL (oEmbed) and when someone opens an embedded player. We store the URLs you selected plus titles and artwork URLs SoundCloud returns.
- **Bandcamp** stores album or track URLs you paste (and an embed id if you paste Bandcamp’s Share → Embed code). Opening a player or link loads Bandcamp. Bandcamp does not offer a public catalog API we can call from this page, so a URL-only item is a link until you paste embed code.
- **LinkedIn** does not let other apps read jobs, schools, or projects from a handle or from being signed in to LinkedIn in the same browser. Sign in with LinkedIn (OAuth) only returns name, photo, and email, and needs a LinkedIn app plus a backend token exchange. You can import LinkedIn’s official data archive in this browser; we keep name, headline, vanity URL, roles, schools, and projects from that file and skip address, birthday, email, and phone. Selected fields are stored here and shared with the audience on that lock. Opening a profile link or photo may still load LinkedIn.

## Your controls

- Delete site data from the browser, or unlink a linked browser in Settings.
- Do not share a legal name. Use a handle.
- Use **Chat** to set how long a thread is kept, or Clear it on both devices (their copy waits until they reconnect).
- Leave **Online** off in Settings (the default) to stay out of nearby rooms. You will not appear on Online. Friends can still message you while this tab is open.
- Leave entirely by closing the tab. On desktop, close the app.
- Revoke a linked device in the desktop vault window. That device can keep its local copy but will not receive further sync.

This is not a substitute for your own judgment. If you feel unsafe, leave and use local resources.
