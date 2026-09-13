# Local Chat desktop

ElectroBun vault for [Local Chat](https://open-message.github.io/local-chat/). This app is a **connector**: it keeps identities on disk, links browsers with a QR code, and two-way merges every identity while it is open. Create and switch profiles at the top of You in the website. Encrypted export and device linking live here, not on GitHub Pages.

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

**Show QR** starts pairing. Scan the code or open the printed `?link=` URL. Opening `https://spark.local:4174/` *without* those query params creates a separate identity, so the phone will not appear under Linked devices and will not sync.

Authorize the browser in the vault window after giving it a name. That device receives **every** identity in the vault (private keys included) and merges any identities it already had. Keep the vault window open while a device is linked so it can sync. Edits on two devices merge when both are connected to the hub; which identity is active stays per device.

For local web development, set **Chat site** to `http://localhost:4173/` and run `make local`. QR codes rewrite localhost to `https://` plus this computer's `.local` name on port 4174 so a phone on the LAN gets WebRTC. Desktop and phone then share the development PeerJS rooms. If Chat site is GitHub Pages while the phone uses spark.local, they will not see each other.

## Vault files

Identities are JSON files under the OS app-data directory (`local-chat-vault/`). Treat them as secrets. Encrypted export wraps the whole vault with a passphrase (PBKDF2 + AES-GCM).

## Link a phone

1. In the vault window, Show QR.
2. On the phone, scan that QR (or paste the full `?link=` URL). HTTPS, localhost, or a LAN host like `https://spark.local:4174` all work *with* the link query.
3. Name the device, then authorize. Identities already on the phone merge into the vault; identities already in the vault copy onto the phone.
4. That phone keeps a local copy of every identity and syncs while this vault is running. Switch profiles at the top of You on the phone or in a browser.
