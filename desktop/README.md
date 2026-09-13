# Local Chat desktop

ElectroBun vault for [Local Chat](https://open-message.github.io/local-chat/). Identities stay on disk in this app. **Open** a profile to chat in a Local Chat window inside this app. Encrypted export, multiple profiles, and device linking live here, not on GitHub Pages.

## Run

From the **repo root**:

```bash
make hutch      # once: install Hutch
make desktop    # sync desktop/ and open the app
make            # list every target
```

Hutch is ElectroBun's CLI. `make hutch` runs:

```bash
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh
```

`make desktop` always runs inside `desktop/`. Do not run `hutch electrobun sync` from the repo root; that writes a leftover `.hutch/` next to the web app.

It needs a graphical display. Cursor remote SSH and a plain SSH login have none, so GTK exits with `cannot open display`. From a laptop that already runs X11 or Wayland: `ssh -Y <this-host>` then `make desktop`. Or log into a desktop session on this machine and run it there.

Over `ssh -Y`, `make desktop` forces software WebKit. GLX/DRI3 warnings (`failed to create drisw screen`, `Could not get DRI3 device`) are expected; XQuartz cannot GPU-accelerate a remote WebKit view. Windows can still be slow. A logged-in desktop on this machine is the usable setup.

That opens the **Local Chat Vault** window. A second small **Local Chat Hub** window loads `desktop-hub.html` from your Chat site so PeerJS/WebRTC can run (it cannot run inside the vault’s `views://` page). Keep `make local` running when Chat site is `http://localhost:4173/`. The hub window must stay open while you link a phone.

**Open** loads that profile in a chat window in this app (not the system browser). **Rename** changes the vault label and the profile handle. **Show QR** starts pairing for a phone: scan the code or open the printed `?link=` URL. Opening `https://spark.local:4174/` *without* those query params creates a separate identity, so the phone will not appear under Linked devices and will not share the vault profile.

If that phone already has an identity that is not in the vault, it asks whether to import it first. Keep the vault window open while a device is linked so it can sync.

For local web development, set **Chat site** to `http://localhost:4173/` and run `make local`. QR codes rewrite localhost to `https://` plus this computer's `.local` name on port 4174 so a phone on the LAN gets WebRTC. Desktop and phone then share the development PeerJS rooms. If Chat site is GitHub Pages while the phone uses spark.local, they will not see each other.

## Vault files

Identities are JSON files under the OS app-data directory (`local-chat-vault/`). Treat them as secrets. Encrypted export wraps the whole vault with a passphrase (PBKDF2 + AES-GCM).

## Link a phone

1. In the vault window, select a profile, then Show QR.
2. On the phone, scan that QR (or paste the full `?link=` URL). HTTPS, localhost, or a LAN host like `https://spark.local:4174` all work *with* the link query.
3. If that browser already has an unsynced identity, import it into the vault or replace it with a vault profile.
4. That phone keeps a local copy and syncs while this vault is running. Open the profile here to use the same identity on this computer.
