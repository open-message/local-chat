# Local Chat — common repo tasks. Run `make` or `make help`.

PORT ?= 4173
DESKTOP := desktop
HUTCH ?= $(firstword $(wildcard $(HOME)/.hutch/bin/hutch) $(shell command -v hutch 2>/dev/null))

.DEFAULT_GOAL := help
.PHONY: help local desktop desktop-sync desktop-build hutch zcta

help: ## List these targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  make %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

local: ## Static app: HTTP localhost:4173 and HTTPS spark.local:4174 (PORT= / HTTPS_PORT=)
	python3 scripts/serve.py $(PORT)

hutch: ## Install the ElectroBun Hutch CLI (once)
	curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh

desktop-sync: ## Download the ElectroBun SDK into desktop/.hutch
	$(call require-hutch)
	$(call require-desktop-free)
	cd $(DESKTOP) && "$(HUTCH)" electrobun sync

desktop: ## Open the Local Chat vault (needs a display)
	$(call require-display)
	$(call require-desktop-free)
	$(MAKE) --no-print-directory desktop-sync
	cd $(DESKTOP) && \
	if case "$$DISPLAY" in localhost:*|127.0.0.1:*) true;; *) false;; esac; then \
		echo "Forwarded X11 ($$DISPLAY): software WebKit (XQuartz has no GPU)"; \
		export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo; \
	fi && \
	"$(HUTCH)" run dev

desktop-build: desktop-sync ## Package a distributable ElectroBun build
	$(call require-hutch)
	cd $(DESKTOP) && "$(HUTCH)" run build

zcta: ## Rebuild ZIP centroids and polygons in data/ (not needed for everyday work)
	bash scripts/build-zcta.sh

define require-desktop-free
	@if pgrep -f '[h]utch-engine electrobun dev --watch' >/dev/null 2>&1; then \
		echo "Another make desktop is already running (hutch electrobun dev --watch)."; \
		echo "That holds Hutch's lock, so a second sync sits forever."; \
		echo "Ctrl+C the old make desktop, then run this again."; \
		exit 1; \
	fi
endef

define require-hutch
	@if [ ! -x "$(HUTCH)" ]; then \
		echo "Hutch not found. Install it with: make hutch"; \
		echo "Then open a new terminal, or run: export PATH=\"\$$HOME/.hutch/bin:\$$PATH\""; \
		exit 1; \
	fi
endef

define require-display
	@if [ -z "$${DISPLAY}$${WAYLAND_DISPLAY}" ]; then \
		echo "No graphical display in this session (echo \$$DISPLAY is empty)."; \
		echo "Cursor Remote SSH never forwards X11 — do not run make desktop from Cursor."; \
		echo "ssh -Y only works if the laptop already has an X server running:"; \
		echo "  macOS: open XQuartz, then ssh -Y"; \
		echo "  Linux: echo \$$DISPLAY must be set on the laptop before ssh -Y"; \
		echo "  Windows: start VcXsrv/GWSL, then ssh -Y"; \
		echo "In that same ssh -Y terminal, echo \$$DISPLAY should be localhost:10.0 (not empty)."; \
		echo "Then run make desktop there. WebKit over X11 may still be very slow."; \
		exit 1; \
	fi
endef
