import { APP_NAME, CHAT_RETENTION_OPTIONS, CHAT_TEXT_MAX, DEFAULT_DISTANCE_MILES, GENDERS, GENDER_SEEK_OPTIONS, GROUP_INVITE_POLICIES, GROUP_MEMBER_MAX, LOOKING_FOR_OPTIONS, MAX_AGE, MIN_AGE, MUSIC_GENRES, MUSIC_INSTRUMENTS, NETWORKING_INTENTS, PEOPLE_FILTER_OPTIONS, availableDistanceOptions, clampDistanceOption, discoveryMiles, distanceOptionIndex, distanceOptionLabel, isCanonicalMesh } from "../config.js";
import { canUndoOutgoing, canUndoOutgoingGroup, chatRetentionMs, lastReadOutgoing, lastReadMessageByPeer, previewChatText } from "../chat.js";
import { track, trackCustomListItem } from "../analytics.js";
import { el, clear } from "../dom.js";
import { distanceMiles, filterAndRank, formatMilesLabel } from "../filters.js";
import { discoveryRooms, loadZips, locate, publishedLoc } from "../geo.js";
import { PairNet } from "../match.js";
import { compressPhoto } from "../photo.js";
import {
  ageFromDob,
  fieldPrivacy,
  genderLabel,
  hasRelationshipIntent,
  identityBasicsComplete,
  isAdult,
  lookingForChips,
  lookingForIntentIds,
  PRIVACY_LEVELS,
  privacyLetter,
  parseYoutubeChannelId,
  profileComplete,
  sanitizeSectionOrder,
  sanitizeYoutubeVideoIds,
  applySectionOrder,
  withFieldPrivacy,
  YOUTUBE_VIDEO_MAX,
} from "../profile.js";
import {
  addBandcampItem,
  BANDCAMP_ITEM_MAX,
  bandcampEmbedUrl,
  bandcampIsShown,
  removeBandcampItem,
  sanitizeBandcamp,
  shareBandcamp,
} from "../bandcamp.js";
import {
  fetchGithubProfile,
  fillGithubRepoImages,
  GITHUB_REPO_MAX,
  githubIsShown,
  githubProfileUrl,
  parseGithubLogin,
  peekGithubRepoImage,
  rememberGithubRepoImage,
  sanitizeGithub,
  shareGithub,
} from "../github.js";
import {
  addSoundCloudItem,
  SOUNDCLOUD_ITEM_MAX,
  SOUNDCLOUD_PLACEHOLDER,
  parseSoundCloudUrl,
  removeSoundCloudItem,
  sanitizeSoundCloud,
  shareSoundCloud,
  soundcloudEmbedHeight,
  soundcloudEmbedUrl,
  soundcloudIsShown,
} from "../soundcloud.js";
import {
  fetchChannelVideos,
  fetchPlaylistVideos,
  parseYoutubePlaylistId,
  youtubePlaylistEmbedUrl,
  youtubeVideoEmbedUrl,
  youtubeVideoThumbUrl,
} from "../youtube.js";
import {
  fetchLinkedInBadge,
  importLinkedInArchive,
  LINKEDIN_DATA_DOWNLOAD_URL,
  LINKEDIN_ITEM_MAX,
  linkedInHasDraft,
  linkedInImportSummary,
  linkedInIsShown,
  linkedInProfileUrl,
  newLinkedInItemId,
  parseLinkedInHandle,
  sanitizeLinkedIn,
  shareLinkedIn,
} from "../linkedin.js";
import { canClearGroup, canInvite, canSetGroupRetention } from "../group.js";
import { qrSvg } from "../qr.js";
import { RoomNet } from "../rooms.js";
import { chatRoomId, isGroupId, loadLanHost, parseLinkParams, parseSharePeerId, shareUrl, stripLinkParams, stripShareParam } from "../share.js";
import {
  addFriend,
  clearChat,
  clearGroupChat,
  getChat,
  getChatRetention,
  getChatRoom,
  getFriend,
  getGroup,
  getGroupInvites,
  getGroupRetention,
  getGroupThemChatReadAt,
  getLastView,
  getLinkedVault,
  getPair,
  getState,
  getThemChatReadAt,
  isFriend,
  isInterested,
  isNavView,
  isOffline,
  isPreciseGeolocation,
  listGroups,
  listIdentities,
  loadStore,
  markChatRead,
  markGroupRead,
  mergeFriendProfile,
  pruneChat,
  rememberChatRoom,
  removeFriend,
  setChatRetention,
  setGroupRetention,
  setLastView,
  setPreciseGeolocation,
  shareMyProfile,
  switchIdentity,
  createIdentityProfile,
  deleteIdentity,
  themInterestedUnmatched,
  totalUnreadCount,
  unlinkVault,
  unreadChatCount,
  unreadGroupCount,
  updateFriend,
  updateProfile,
  updateStore,
} from "../store.js";
import { VaultNet } from "../vault-net.js";

function optionLabel(questions, id, value) {
  const q = questions.find((x) => x.id === id);
  return q?.options.find((o) => o.id === value)?.label || value || "—";
}

function formatDob(dob) {
  if (!dob) return "Set when you enter the app";
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return String(dob);
  return born.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatLatLng(loc) {
  const point = publishedLoc(loc);
  if (!point) return "From GPS";
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function mapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function mapsLink(query, label, ariaLabel) {
  return el("a", {
    class: "maps-link",
    href: mapsSearchUrl(query),
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": ariaLabel || `Open ${label} in Google Maps`,
  }, label);
}

function unreadLabel(n) {
  if (n > 99) return "99+";
  return String(n);
}

function normalizeListQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function listQueryKey(value) {
  return normalizeListQuery(value).toLowerCase();
}

function textMatchesQuery(text, query) {
  const q = listQueryKey(query);
  if (!q) return true;
  return String(text || "").toLowerCase().includes(q);
}

function optionSearchKeys(option) {
  return [option.id, option.label];
}

function optionMatchesQuery(option, query) {
  return optionSearchKeys(option).some((key) => textMatchesQuery(key, query));
}

function matchingOptions(options, query) {
  return (options || []).filter((option) => optionMatchesQuery(option, query));
}

function matchingTags(tags, query) {
  return (tags || []).filter((tag) => textMatchesQuery(tag, query));
}

function resolveListPick(items, query, keysOf) {
  const text = normalizeListQuery(query);
  if (!text) return null;
  const q = text.toLowerCase();
  const exact = items.find((item) => keysOf(item).some((key) => String(key).toLowerCase() === q));
  if (exact) return { kind: "preset", item: exact };
  const matches = items.filter((item) => keysOf(item).some((key) => String(key).toLowerCase().includes(q)));
  if (matches.length === 1) return { kind: "preset", item: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "custom", value: q };
}

function pickListHint(query, matchCount) {
  if (!normalizeListQuery(query)) return "Type to search the list. Add your own only if it is missing.";
  if (matchCount > 1) return "Several matches — pick one below, or keep typing.";
  if (matchCount === 1) return "One match. Add selects it, or tap the chip.";
  return "No matches. Add this as your own.";
}

export class App {
  constructor({ tags, questions }) {
    this.tags = tags;
    this.questions = questions;
    this.main = document.getElementById("main");
    this.nav = document.getElementById("nav");
    this.qrBtn = document.getElementById("qr-btn");
    this.filterBtn = document.getElementById("filter-btn");
    this.offlineBtn = document.getElementById("offline-btn");
    this.view = "stack";
    this.stackIndex = 0;
    this.people = [];
    this.ranked = [];
    this.rooms = [];
    this.roomNet = null;
    this.pairNet = null;
    this.matchOverlay = null;
    this.filterOpen = false;
    this.qrOpen = false;
    this.mergePeerId = null;
    this.friendPeerId = null;
    this.chatPeerId = null;
    this.chatGroupId = null;
    this.chatCreating = false;
    this.groupInviteOpen = false;
    this.personPeerId = null;
    this.chatRooms = new Map();
    this.chatLogEl = null;
    this.chatSeenIds = new Set();
    this.chatPruneTimer = null;
    this.typingEl = null;
    this.readEl = null;
    this.composePeerId = null;
    this.composeInput = null;
    this.composeDrafts = new Map();
    this.profileAsked = new Set();
    this.error = "";
    this.busy = false;
    this.locating = false;
    this.locateAbort = null;
    this.locatePromise = null;
    this.needGps = false;
    this.sessionFix = null;
    this.statusText = "";
    this.statusEl = null;
    this.profileOpen = new Set();
    this.profileDragging = false;
    this.profileRenderQueued = false;
    this.lookingForEnabled = null;
    this.youPreview = false;
    this.linkPending = null;
    this.linkBusy = false;
    this.linkError = "";
    this.linkNeedsChoice = false;
    this.linkChoice = "";
    this.vaultNet = null;
    this.ytList = { channelId: "", videos: [], token: "", loading: false, error: "" };
    this.ytMusicList = { playlistId: "", videos: [], loading: false, error: "" };
    this.ghList = { login: "", repos: [], loading: false, error: "" };
    this.ghThumbLoading = new Set();
    this.scAdd = { loading: false, error: "" };
    this.bcAdd = { error: "" };
    this.liBadge = { handle: "", data: null, loading: false, error: "" };
    this.liImport = { loading: false, error: "", note: "" };
  }

  async start() {
    await Promise.all([loadStore(), loadLanHost()]);
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (isNavView(view)) this.view = view;
    else {
      const last = getLastView();
      if (last) this.view = last;
    }
    if (isOffline() && this.view === "stack") this.view = "friends";
    if (params.get("filters") === "1") this.filterOpen = true;
    const shareId = parseSharePeerId();
    if (shareId && shareId !== getState().peerId) {
      this.personPeerId = shareId;
      track("qr_follow");
    }
    const link = parseLinkParams();
    if (link) {
      if (getLinkedVault()?.hubId === link.hubId) this.linkPending = null;
      else this.linkPending = link;
    }
    const cleaned = stripLinkParams(stripShareParam());
    if (cleaned !== location.href) history.replaceState({}, "", cleaned);
    this.nav.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (!btn) return;
      this.personPeerId = null;
      this.qrOpen = false;
      if (btn.dataset.view === "friends" && this.view === "friends") this.friendPeerId = null;
      if (btn.dataset.view === "chat" && this.view === "chat") {
        this.chatPeerId = null;
        this.chatGroupId = null;
        this.chatCreating = false;
        this.groupInviteOpen = false;
      }
      if (btn.dataset.view === "you" && this.view === "you") this.youPreview = false;
      this.view = btn.dataset.view;
      if (this.view !== "friends") this.friendPeerId = null;
      if (this.view !== "you") this.youPreview = false;
      this.render();
    });
    this.filterBtn?.addEventListener("click", () => {
      this.filterOpen = true;
      this.render();
    });
    this.qrBtn?.addEventListener("click", () => {
      this.qrOpen = true;
      track("qr_open");
      this.render();
    });
    this.offlineBtn?.addEventListener("click", () => this.goOffline());
    this.render();
    if (getLinkedVault() && !this.linkPending) this.startVaultSync();
  }

  setPresence(text) {
    const next = String(text || "").trim();
    if (next) this.statusText = next;
    if (this.statusEl?.isConnected) this.statusEl.textContent = this.connectionLabel();
  }

  connectionLabel() {
    if (isOffline()) return "Offline — friends only";
    const text = String(this.statusText || "").trim();
    if (!text || /offline/i.test(text)) {
      return this.roomNet?.discovery ? "Online in nearby ZIP rooms" : "Connecting…";
    }
    return text;
  }

  applyChrome() {
    const offline = isOffline();
    const onlineBtn = this.nav.querySelector('[data-view="stack"]');
    if (onlineBtn) onlineBtn.hidden = offline;
    this.nav.classList.toggle("friends-only", offline);
    for (const btn of this.nav.querySelectorAll("button")) {
      btn.classList.toggle("active", btn.dataset.view === this.view);
    }
    this.updateChatBadge();
  }

  updateChatBadge() {
    const btn = this.nav.querySelector('[data-view="chat"]');
    if (!btn) return;
    let badge = btn.querySelector("[data-chat-badge]");
    if (!badge) {
      badge = el("span", { class: "nav-badge", "data-chat-badge": "1" });
      btn.append(badge);
    }
    const n = totalUnreadCount();
    badge.hidden = n <= 0;
    badge.textContent = n > 0 ? unreadLabel(n) : "";
    btn.setAttribute("aria-label", n > 0 ? `Chat, ${n} unread` : "Chat");
  }

  homeView() {
    return isOffline() ? "friends" : "stack";
  }

  setPreciseLocation(on) {
    const next = Boolean(on);
    if (isPreciseGeolocation() === next) return;
    setPreciseGeolocation(next);
    track(next ? "precise_geo_on" : "precise_geo_off");
    this.publishProfile();
    this.refreshDiscoveryRooms().then(() => this.syncLocationStatus());
  }

  personIsOnline(peerId) {
    return Boolean(this.livePerson(peerId) || this.pairNet?.isConnected?.(peerId));
  }

  setPresenceMode(offline) {
    const next = Boolean(offline);
    if (isOffline() === next) {
      if (!next) {
        if (this.roomNet) this.roomNet.joinDiscovery(this.rooms);
        else this.ensureNetwork();
      }
      return;
    }
    updateStore({ offline: next });
    track(next ? "go_offline" : "go_online");
    if (next) {
      if (this.view === "stack") this.view = "friends";
      this.setPresence("Offline — friends only");
      this.roomNet?.leaveDiscovery();
      this.people = [];
      this.refreshRanked();
      this.pairNet?.retainPeers(this.watchPeerIds());
    } else {
      this.setPresence("Connecting…");
      if (this.roomNet) {
        this.roomNet.joinDiscovery(this.rooms);
        this.pairNet?.syncOutgoingInterest(this.watchPeerIds());
        this.trackZoneJoins();
      } else {
        this.ensureNetwork();
      }
    }
  }

  goOnline() {
    this.setPresenceMode(false);
    this.view = "stack";
    this.render();
  }

  goOffline() {
    this.setPresenceMode(true);
    this.render();
  }

  trackZoneJoins() {
    const count = this.rooms.length;
    if (count) track("zone_join", { level: "zip", count });
  }

  render() {
    if (this.profileDragging) {
      this.profileRenderQueued = true;
      return;
    }
    this.profileRenderQueued = false;
    this.stopChatPrune();
    const draftKey = this.chatGroupId || this.composePeerId || this.chatPeerId;
    if (this.composeInput?.isConnected && draftKey) {
      this.composeDrafts.set(draftKey, this.composeInput.value);
    }
    if (this.composePeerId && (this.view !== "chat" || this.chatPeerId !== this.composePeerId)) {
      this.pairNet?.setTyping(this.composePeerId, false);
      this.composePeerId = null;
    }
    document.getElementById("qr-sheet")?.remove();
    document.getElementById("filter-sheet")?.remove();
    const { profile } = getState();
    clear(this.main);
    this.nav.hidden = true;
    if (this.qrBtn) this.qrBtn.hidden = true;
    if (this.filterBtn) this.filterBtn.hidden = true;
    if (this.offlineBtn) this.offlineBtn.hidden = true;
    this.applyChrome();

    if (this.linkPending) {
      this.main.append(this.renderLinking());
      if (!this.linkError && !this.linkBusy) this.beginLink();
      return;
    }

    if (!identityBasicsComplete(profile)) {
      this.main.append(this.renderAgeGate());
      return;
    }
    if (!this.sessionFix) {
      const hasPriorLoc = Boolean(profile.loc && profile.zip);
      if (this.locating) {
        this.main.append(this.renderGps({ locating: true }));
        return;
      }
      if (this.needGps || !hasPriorLoc) {
        this.main.append(this.renderGps());
        return;
      }
      this.refreshLocation();
      this.main.append(this.renderGps({ locating: true }));
      return;
    }
    if (!profileComplete(profile)) {
      this.main.append(this.renderProfile({ onboarding: true }));
      return;
    }

    this.nav.hidden = false;
    if (this.qrBtn) this.qrBtn.hidden = false;
    if (isOffline() && this.view === "stack") this.view = "friends";
    this.applyChrome();
    this.ensureNetwork();
    this.openShareTarget();
    setLastView(this.view);
    if (this.filterBtn) this.filterBtn.hidden = this.view !== "stack" || isOffline();
    if (this.offlineBtn) this.offlineBtn.hidden = this.view !== "stack" || isOffline();
    if (this.view === "friends") this.main.append(this.renderFriends());
    else if (this.view === "chat") this.main.append(this.renderChat());
    else if (this.view === "person") this.main.append(this.renderSharedPerson());
    else if (this.view === "you") {
      this.main.append(this.youPreview
        ? this.renderOwnProfilePreview()
        : this.renderProfile({ onboarding: false }));
    }
    else if (this.view === "settings") this.main.append(this.renderSettings());
    else this.main.append(this.renderStack());
    if (this.filterOpen) document.body.append(this.renderFilterSheet());
    if (this.qrOpen) document.body.append(this.renderQrSheet());
    this.updateChatBadge();
  }

  publishProfile() {
    this.roomNet?.broadcastProfile();
    this.pairNet?.pushProfiles();
  }

  openShareTarget() {
    const id = this.personPeerId;
    if (!id) return;
    if (id === getState().peerId) {
      this.personPeerId = null;
      return;
    }
    if (isFriend(id)) {
      this.view = "chat";
      this.chatPeerId = id;
      this.personPeerId = null;
      return;
    }
    this.view = "person";
  }

  discoveryOrigin() {
    return this.sessionFix?.raw || getState().profile.loc;
  }

  async buildDiscoveryRooms() {
    const rows = await loadZips();
    const loc = this.discoveryOrigin();
    return discoveryRooms(loc, rows, { miles: discoveryMiles(getState().filters.distance) });
  }

  refreshDiscoveryRooms() {
    if (!this.sessionFix || !this.roomNet || this.busy) return Promise.resolve();
    return this.buildDiscoveryRooms()
      .then((rooms) => {
        this.rooms = rooms;
        if (isOffline()) return;
        this.roomNet.syncRooms(rooms);
        this.trackZoneJoins();
      })
      .catch((err) => {
        this.setPresence(err.message || "Could not update nearby ZIP rooms");
      });
  }

  cancelLocation() {
    this.locateAbort?.abort();
  }

  refreshLocation({ interactive = false, force = false } = {}) {
    if (this.locating) return this.locatePromise;
    if (this.sessionFix && !force) return this.locatePromise;
    this.locateAbort = new AbortController();
    this.locating = true;
    this.locatePromise = locate({ signal: this.locateAbort.signal })
      .then(async (found) => {
        updateProfile({ loc: found.loc, zip: found.zip });
        this.sessionFix = found;
        this.needGps = false;
        this.error = "";
        if (interactive) track("gps_granted");
        if (this.roomNet) {
          await this.refreshDiscoveryRooms();
          this.publishProfile();
        }
        return found;
      })
      .catch((err) => {
        if (err?.name === "AbortError") {
          this.error = "";
          if (!this.sessionFix) this.needGps = true;
          return;
        }
        this.error = err.message || "Location was denied or failed.";
        if (!this.sessionFix) this.needGps = true;
        if (interactive) track("gps_denied");
      })
      .finally(() => {
        this.locating = false;
        this.locateAbort = null;
        this.locatePromise = null;
        this.render();
      });
    return this.locatePromise;
  }

  ensureNetwork() {
    if (this.roomNet || this.busy || !this.sessionFix) return;
    if (isOffline() && !getState().friends.length && !this.personPeerId && !this.friendPeerId && !this.chatPeerId) {
      this.setPresence("Offline — friends only");
      return;
    }
    this.busy = true;
    this.buildDiscoveryRooms()
      .then((rooms) => {
        this.rooms = rooms;
        this.roomNet = new RoomNet({
          onRoster: (people) => {
            const ids = people.map((p) => p.peerId).sort().join(",");
            this.people = people;
            this.refreshRanked();
            if (ids === this.rosterIds) return;
            this.rosterIds = ids;
            this.pairNet?.syncOutgoingInterest(this.watchPeerIds(people));
            if (this.personPeerId) this.askProfile(this.personPeerId);
            const ready = profileComplete(getState().profile) && isAdult(getState().profile.dob);
            if (!ready) return;
            if (this.view === "stack" || this.view === "friends" || this.view === "chat" || this.view === "person") this.render();
          },
          onStatus: (text) => this.setPresence(text),
          onPairConnection: (conn) => this.pairNet?.attachIncoming(conn),
        });
        this.pairNet = new PairNet({
          roomNet: this.roomNet,
          onMatch: (peerId) => this.showMatch(peerId),
          onChange: (peerId, reason) => {
            if (peerId && !isGroupId(peerId)) this.applyRevealedHandle(peerId);
            if (reason === "chat-typing") {
              this.refreshTypingIndicator(peerId);
              return;
            }
            if (reason === "chat-read") {
              this.refreshReadReceipts(peerId);
              this.refreshUndoButtons();
              return;
            }
            if (reason === "chat" && this.refreshChatLog(peerId)) {
              this.acknowledgeChat(peerId);
              this.refreshReadReceipts(peerId);
              this.refreshTypingIndicator(peerId);
              this.updateChatBadge();
              return;
            }
            if (reason === "group-chat" && this.refreshGroupChatLog(peerId)) {
              this.acknowledgeGroup(peerId);
              this.placeGroupReadReceipts(peerId);
              this.updateChatBadge();
              return;
            }
            if (reason === "group-read") {
              this.placeGroupReadReceipts(peerId);
              this.refreshUndoButtons({ group: true });
              return;
            }
            if ((reason === "chat-clear" || reason === "chat-policy") && this.view === "chat") {
              this.render();
              return;
            }
            if ((reason === "group" || reason === "group-invite") && this.view === "chat") {
              this.render();
              return;
            }
            if (this.view === "stack" || this.view === "friends" || this.view === "chat" || this.view === "person") this.render();
            else this.updateChatBadge();
            this.refreshMatchOverlay(peerId);
          },
          onTurnFailed: (_peerId, info) => this.showTurnFailed(info),
        });
        return this.roomNet.start(rooms, { discovery: !isOffline() });
      })
      .then(() => {
        if (isOffline()) this.roomNet?.leaveDiscovery();
        else this.roomNet?.joinDiscovery(this.rooms);
        this.pairNet?.syncOutgoingInterest(this.watchPeerIds(this.people));
        if (this.personPeerId) this.askProfile(this.personPeerId);
        if (this.friendPeerId) this.askProfile(this.friendPeerId);
        if (this.chatPeerId) this.askProfile(this.chatPeerId);
        this.startVaultSync();
        if (!isOffline()) this.trackZoneJoins();
      })
      .catch((err) => {
        this.setPresence(err.message || "Could not connect");
      })
      .finally(() => {
        this.busy = false;
      });
  }

  refreshRanked() {
    const me = getState().profile;
    this.ranked = filterAndRank(me, this.people, this.questions);
    if (this.stackIndex >= this.ranked.length) this.stackIndex = Math.max(0, this.ranked.length - 1);
  }

  watchPeerIds(people) {
    const ids = isOffline() ? [] : (people || this.people || []).map((p) => p.peerId);
    if (this.personPeerId) ids.push(this.personPeerId);
    if (this.friendPeerId) ids.push(this.friendPeerId);
    if (this.chatPeerId) ids.push(this.chatPeerId);
    for (const f of getState().friends) ids.push(f.peerId);
    for (const g of listGroups()) {
      for (const m of g.members || []) ids.push(m.peerId);
      for (const id of g.pendingInvites || []) ids.push(id);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  knownPerson(peerId) {
    return this.pairNet?.profiles?.get(peerId)
      || this.livePerson(peerId)
      || getFriend(peerId)
      || null;
  }

  async ensureChatRoom(peerId) {
    if (this.chatRooms.has(peerId)) return this.chatRooms.get(peerId);
    const stored = getChatRoom(peerId);
    if (stored) {
      this.chatRooms.set(peerId, stored);
      return stored;
    }
    const id = await chatRoomId(getState().peerId, peerId);
    this.chatRooms.set(peerId, id);
    rememberChatRoom(peerId, id);
    return id;
  }

  askProfile(peerId) {
    if (!peerId || !this.pairNet) return;
    this.pairNet.ensure(peerId);
    if (this.profileAsked.has(peerId)) return;
    this.profileAsked.add(peerId);
    this.pairNet.requestProfile(peerId);
  }

  identityLabel(p, identities = listIdentities()) {
    const handle = String(p?.handle || "").trim() || "New profile";
    const same = identities.filter((x) => (String(x.handle || "").trim() || "New profile") === handle);
    if (same.length < 2) return handle;
    return `${handle} · ${String(p.peerId || "").slice(4, 10)}`;
  }

  async applyIdentityChange(fn) {
    this.error = "";
    try {
      await fn();
      location.reload();
    } catch (err) {
      this.error = err.message || "Could not switch profiles.";
      this.render();
    }
  }

  renderProfileSwitcher() {
    const identities = listIdentities();
    const active = identities.find((p) => p.active) || identities[0];
    const canDelete = identities.length > 1;
    return el("section", { class: "panel stack-col profile-switcher" },
      el("p", { class: "profile-switcher-label" }, "Profiles"),
      this.error ? el("p", { class: "disclaimer" }, this.error) : null,
      el("div", { class: "chips profile-switcher-chips" },
        ...identities.map((p) => el("button", {
          class: `chip ${p.active ? "on" : ""}`,
          type: "button",
          "aria-current": p.active ? "true" : null,
          dataset: { peerId: p.peerId },
          onClick: async (e) => {
            const id = e.currentTarget?.dataset?.peerId || p.peerId;
            if (!id || p.active) return;
            setLastView("you");
            await this.applyIdentityChange(() => switchIdentity(id));
          },
        }, this.identityLabel(p, identities))),
        el("button", {
          class: "chip",
          type: "button",
          onClick: async () => {
            setLastView("you");
            await this.applyIdentityChange(() => createIdentityProfile());
          },
        }, "+ New")
      ),
      canDelete ? el("button", {
        class: "btn secondary profile-switcher-delete",
        type: "button",
        onClick: async () => {
          const name = this.identityLabel(active, identities);
          if (!confirm(`Delete ${name} from this device? Linked devices will drop it on the next sync.`)) return;
          setLastView("you");
          await this.applyIdentityChange(() => deleteIdentity(active.peerId));
        },
      }, "Delete this profile") : null
    );
  }

  withProfileSwitcher(node, { always = false } = {}) {
    if (!always && listIdentities().length < 2) return node;
    return el("section", { class: "stack-col" }, this.renderProfileSwitcher(), node);
  }

  renderAgeGate() {
    const { profile } = getState();
    const blocked = profile.dob && !isAdult(profile.dob);
    const selfDescribe = (profile.gender || "") === "self";
    const selfInput = el("input", {
      id: "gender-self",
      value: profile.genderSelf || "",
      placeholder: "How you describe your gender",
      required: selfDescribe,
      autocomplete: "off",
    });
    const selfField = el("div", { class: "field", hidden: !selfDescribe },
      el("label", { for: "gender-self" }, "Self-describe"),
      selfInput
    );
    const genderSel = this.select(GENDERS, profile.gender || "", (v) => {
      const show = v === "self";
      selfField.hidden = !show;
      selfInput.required = show;
      if (!show) selfInput.value = "";
    });
    genderSel.id = "gender";
    genderSel.required = true;
    genderSel.autocomplete = "sex";
    const form = el("form", {
      class: "panel stack-col",
      onSubmit: (e) => {
        e.preventDefault();
        const handle = form.querySelector("#handle").value.trim();
        const dob = form.querySelector("#dob").value;
        const gender = form.querySelector("#gender").value;
        const genderSelf = gender === "self" ? selfInput.value.trim() : "";
        if (!handle || !dob || !gender || (gender === "self" && !genderSelf)) {
          updateProfile({ handle, dob, gender, genderSelf });
          this.render();
          return;
        }
        updateProfile({ handle, dob, gender, genderSelf });
        if (!isAdult(dob)) {
          this.render();
          return;
        }
        track("age_gate_complete");
        this.render();
      },
    },
      el("h1", {}, "Age Eligibility & Restrictions"),
      el("p", { class: "lede" }, "You must be at least 18 years of age to access or use the interactive chat features of this Website. By using the chat services, you represent and warrant that you are at least 18 years old and have the legal capacity to enter into this agreement."),
      el("p", { class: "lede" }, "We do not knowingly collect, solicit, or maintain personal information or chat logs from anyone, including individuals under the age of 18."),
      el("p", { class: "hint" }, "Handle, date of birth, and gender are required and cannot be changed later. Date of birth stays on this device. We only share your age, not the date."),
      el("div", { class: "field" },
        el("label", { for: "handle" }, "Handle"),
        el("input", {
          id: "handle",
          value: profile.handle || "",
          maxlength: "32",
          placeholder: "A nickname",
          required: true,
          autocomplete: "nickname",
        })
      ),
      el("div", { class: "field" },
        el("label", { for: "dob" }, "Date of birth"),
        el("input", {
          id: "dob",
          type: "date",
          value: profile.dob || "",
          max: new Date().toISOString().slice(0, 10),
          required: true,
          autocomplete: "bday",
        })
      ),
      el("div", { class: "field" },
        el("label", { for: "gender" }, "Gender"),
        genderSel
      ),
      selfField,
      blocked ? el("p", { class: "disclaimer" }, "You must be at least 18 years old to continue.") : null,
      el("div", { class: "row" },
        el("button", { class: "btn", type: "submit" }, "Continue")
      ),
      el("p", { class: "hint" }, "Have Local Chat desktop? Scan its QR code to copy a saved identity onto this browser.")
    );
    return this.withProfileSwitcher(form);
  }

  renderGps({ locating = false } = {}) {
    const waiting = locating || this.locating;
    const box = el("section", { class: "panel stack-col" },
      el("h1", {}, "Share your location"),
      el("p", { class: "lede" }, "A GPS-enabled browser finds US ZIP codes within your distance setting. Others can see that ZIP from the ZIP lock on You. Precise location in Settings adds a Geo location lock for this GPS fix, and unlocks distances under 2 miles. Each time you open this app we take a fresh fix and rebuild the nearby ZIP rooms used to find people."),
      el("p", { class: "disclaimer" }, "GPS can be spoofed. This app cannot verify where you really are."),
      this.error ? el("p", { class: "disclaimer" }, this.error) : null,
      el("button", {
        class: "btn",
        type: "button",
        disabled: waiting,
        onClick: () => {
          this.error = "";
          this.needGps = false;
          this.refreshLocation({ interactive: true });
          this.render();
        },
      }, waiting ? "Finding nearby ZIP codes…" : "Use my location"),
      waiting && this.locateAbort
        ? el("button", {
          class: "btn secondary",
          type: "button",
          onClick: () => this.cancelLocation(),
        }, "Cancel")
        : null
    );
    return this.withProfileSwitcher(box);
  }

  renderProfile({ onboarding }) {
    const p = getState().profile;
    const wrap = el("section", { class: "stack-col" });
    const handle = String(p.handle || "").trim();
    const age = ageFromDob(p.dob);
    const gender = genderLabel(p);
    const zip = String(p.zip || "").trim();
    const meta = [
      gender,
      age != null ? String(age) : "",
      zip ? `ZIP ${zip}` : "",
    ].filter(Boolean);
    wrap.append(this.renderProfileSwitcher());
    wrap.append(
      el("section", { class: `panel you-hero${p.photo ? " has-photo" : ""}` },
        p.photo ? el("img", {
          class: "you-hero-photo",
          src: p.photo,
          alt: handle || "Your photo",
        }) : null,
        el("div", { class: "you-hero-body stack-col" },
          el("h1", {}, handle || (onboarding ? "Your profile" : "You")),
          meta.length ? el("p", { class: "you-hero-meta" }, meta.join(" · ")) : null,
          el("p", { class: "hint" }, "Drag the grips to rearrange sections. That order is what people see on your profile."),
          el("div", { class: "row section-toolbar" },
            el("button", {
              class: "btn secondary",
              type: "button",
              onClick: () => this.setAllProfileSections(true, wrap),
            }, "Show all"),
            el("button", {
              class: "btn secondary",
              type: "button",
              onClick: () => this.setAllProfileSections(false, wrap),
            }, "Hide all"),
            onboarding ? null : el("button", {
              class: "btn secondary",
              type: "button",
              onClick: () => {
                this.youPreview = "public";
                this.render();
              },
            }, "View Profile")
          )
        )
      )
    );
    const dating = hasRelationshipIntent(p);
    const sections = {
      about: this.profileSection("about", "About you",
        p.photo ? el("img", { class: "photo-preview", src: p.photo, alt: "Your photo" }) : null,
        this.field("Photo (required)", el("input", {
          type: "file",
          accept: "image/*",
          onChange: async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const photo = await compressPhoto(file);
              updateProfile({ photo });
              this.publishProfile();
              this.render();
            } catch (err) {
              alert(err.message);
            }
          },
        }), { field: "photo" }),
        this.field("Handle", el("p", { class: "hint privacy-value" },
          handle || "Set when you enter the app"
        ), { field: "handle" }),
        this.field("Gender", el("p", { class: "hint privacy-value" },
          gender || "Set when you enter the app"
        ), { field: "gender" }),
        this.field("Date of birth", el("div", {},
          el("p", { class: "hint privacy-value" }, formatDob(p.dob)),
          el("p", { class: "hint" }, "Stays on this device. Other people see your age, not this date.")
        )),
        this.field("Age", el("p", { class: "hint privacy-value" },
          ageFromDob(p.dob) == null ? "Set when you enter the app" : String(ageFromDob(p.dob))
        ), { field: "age" }),
        this.field("ZIP", el("div", {},
          el("p", { class: "hint privacy-value" }, p.zip || "From GPS"),
          el("p", { class: "hint" }, isPreciseGeolocation()
            ? "ZIP code only. GPS is a separate Geo location lock below."
            : "ZIP code only. Coordinates are not shared unless Precise location is on in Settings.")
        ), { field: "loc" }),
        isPreciseGeolocation()
          ? this.field("Geo location", el("div", {},
              el("p", { class: "hint privacy-value" }, formatLatLng(p.loc)),
              el("p", { class: "hint" }, "Anyone who can see this gets your GPS coordinates, which can mark a home or workplace.")
            ), { field: "preciseLoc" })
          : null,
      ),
      looking: this.renderLookingForSection(p),
      interests: this.tagEditor("Interests", "interests"),
      hobbies: this.tagEditor("Hobbies", "hobbies"),
      antiInterests: dating ? this.tagEditor("Relationship deal breakers", "antiInterests", true) : null,
      values: dating ? this.renderQuestionnaire() : null,
      youtube: this.renderYoutubeSection(p),
      "youtube-music": this.renderYoutubeMusicSection(p),
      linkedin: this.renderLinkedInSection(p),
      github: this.renderGithubSection(p),
      soundcloud: this.renderSoundCloudSection(p),
      bandcamp: this.renderBandcampSection(p),
    };
    const list = el("div", {
      class: "stack-col profile-sections",
      role: "list",
      "aria-label": "Profile sections",
    });
    for (const id of sanitizeSectionOrder(p.sectionOrder)) {
      const node = sections[id];
      if (node) list.append(node);
    }
    wrap.append(
      list,
      el("section", { class: "panel stack-col" },
        el("button", {
          class: "btn",
          type: "button",
          onClick: () => {
            updateProfile({});
            if (!profileComplete(getState().profile)) {
              alert("Add a photo, what you are looking for, and location first.");
              return;
            }
            track("profile_saved");
            this.publishProfile();
            this.view = this.homeView();
            this.render();
          },
        }, onboarding ? "Save and find people nearby" : "Save profile")
      )
    );
    return wrap;
  }

  renderOwnProfilePreview() {
    const audience = PRIVACY_LEVELS.some((o) => o.id === this.youPreview)
      ? this.youPreview
      : "public";
    const person = shareMyProfile(audience);
    const copy = {
      public: "This is what people nearby see before you connect.",
      connections: "This is what people see after you both connect.",
      friends: "This is what friends see.",
      me: "This is everything on your profile, including what you keep private.",
    };
    return el("section", { class: "stack-col" },
      this.renderProfileSwitcher(),
      el("section", { class: "panel stack-col" },
        el("h1", {}, "You"),
        el("p", { class: "lede" }, copy[audience]),
        el("div", { class: "chips audience-tabs" },
          ...PRIVACY_LEVELS.map((o) => el("button", {
            class: `chip ${o.id === audience ? "on" : ""}`,
            type: "button",
            onClick: () => {
              this.youPreview = o.id;
              this.render();
            },
          }, o.label))
        ),
        el("button", {
          class: "btn secondary",
          type: "button",
          onClick: () => {
            this.youPreview = false;
            this.render();
          },
        }, "Close")
      ),
      this.personCard(person, null, { hideHandle: !person.handle, full: true })
    );
  }

  renderYoutubeSection(p) {
    const id = parseYoutubeChannelId(p.youtubeChannelId);
    const draft = p.youtubeChannelId || "";
    const selected = sanitizeYoutubeVideoIds(p.youtubeVideoIds);
    if (id && this.ytList.channelId !== id && !this.ytList.loading) {
      queueMicrotask(() => this.loadYoutubeVideos(id));
    }
    return this.profileSection("youtube", "YouTube",
      this.field("Public channel ID", el("input", {
        value: draft,
        maxlength: "120",
        placeholder: "UCxxx or youtube.com/channel/UCxxx",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": "YouTube channel ID",
        onInput: (e) => {
          const next = parseYoutubeChannelId(e.target.value) || e.target.value.trim();
          updateProfile({ youtubeChannelId: next });
        },
        onChange: (e) => {
          const next = parseYoutubeChannelId(e.target.value) || e.target.value.trim();
          const parsed = parseYoutubeChannelId(next);
          const keep = parsed && parsed === this.ytList.channelId;
          updateProfile({
            youtubeChannelId: next,
            youtubeVideoIds: keep ? getState().profile.youtubeVideoIds : [],
          });
          if (!keep) this.ytList = { channelId: "", videos: [], token: "", loading: false, error: "" };
          this.render();
        },
      })),
      el("p", { class: "hint" },
        draft && !id
          ? "Need a channel ID (starts with UC), or paste a youtube.com/channel/UC… link. @handles will not work."
          : "Optional. The list is this channel's public uploads (up to 200). Tap videos to show them on your profile. For a playlist, use YouTube Music below."
      ),
      id ? this.youtubePicker(id, selected) : null,
      { privacyField: "youtubeChannelId" }
    );
  }

  youtubePicker(channelId, selectedIds) {
    const selected = new Set(selectedIds);
    const catalog = this.ytList.channelId === channelId ? this.ytList : { videos: [], token: "", loading: true, error: "" };
    const count = el("p", { class: "hint youtube-pick-count" },
      selected.size
        ? `${selected.size} of ${YOUTUBE_VIDEO_MAX} selected for your profile`
        : `Tap videos to show them on your profile (up to ${YOUTUBE_VIDEO_MAX}).`
    );
    const list = el("div", { class: "youtube-pick-list", role: "listbox", "aria-label": "Channel videos", "aria-multiselectable": "true" });
    const drawCount = () => {
      const n = selected.size;
      count.textContent = n
        ? `${n} of ${YOUTUBE_VIDEO_MAX} selected for your profile`
        : `Tap videos to show them on your profile (up to ${YOUTUBE_VIDEO_MAX}).`;
    };
    const toggle = (id, row) => {
      if (selected.has(id)) selected.delete(id);
      else {
        if (selected.size >= YOUTUBE_VIDEO_MAX) return;
        selected.add(id);
      }
      row.classList.toggle("on", selected.has(id));
      row.setAttribute("aria-selected", selected.has(id) ? "true" : "false");
      updateProfile({ youtubeVideoIds: [...selected] });
      drawCount();
    };
    for (const video of catalog.videos) {
      const on = selected.has(video.id);
      const row = el("button", {
        class: `youtube-pick ${on ? "on" : ""}`,
        type: "button",
        role: "option",
        "aria-selected": on ? "true" : "false",
        onClick: () => toggle(video.id, row),
      },
        el("img", {
          class: "youtube-pick-thumb",
          src: youtubeVideoThumbUrl(video.id),
          alt: "",
          loading: "lazy",
        }),
        el("span", { class: "youtube-pick-copy" },
          el("span", { class: "youtube-pick-title" }, video.title || video.id),
          video.duration ? el("span", { class: "youtube-pick-duration" }, video.duration) : null
        )
      );
      list.append(row);
    }
    const wrap = el("div", { class: "youtube-channel" },
      count,
      catalog.error ? el("p", { class: "disclaimer" }, catalog.error) : null,
      catalog.loading && !catalog.videos.length ? el("p", { class: "hint" }, "Loading videos from YouTube…") : null,
      catalog.videos.length ? list : null,
      catalog.loading && catalog.videos.length ? el("p", { class: "hint" }, "Loading titles…") : null
    );
    return wrap;
  }

  async loadYoutubeVideos(channelId) {
    const id = parseYoutubeChannelId(channelId);
    if (!id || this.ytList.loading) return;
    this.ytList = { channelId: id, videos: [], token: "", loading: true, error: "" };
    this.render();
    try {
      const data = await fetchChannelVideos(id, (partial) => {
        if (this.ytList.channelId !== id) return;
        this.ytList = {
          channelId: id,
          videos: (partial || []).map((item) => ({
            id: String(item.id || ""),
            title: String(item.title || ""),
            duration: String(item.duration || ""),
          })),
          token: "",
          loading: true,
          error: "",
        };
        this.render();
      });
      const videos = [];
      const seen = new Set();
      for (const item of data.videos || []) {
        const videoId = String(item?.id || "");
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);
        videos.push({
          id: videoId,
          title: String(item.title || ""),
          duration: String(item.duration || ""),
        });
      }
      this.ytList = {
        channelId: id,
        videos,
        token: "",
        loading: false,
        error: videos.length ? "" : "No public uploads found on this channel.",
      };
    } catch (err) {
      this.ytList = {
        ...this.ytList,
        channelId: id,
        loading: false,
        error: err.message || "Could not load channel videos.",
      };
    }
    this.render();
  }

  youtubeVideoViewer(videoIds, { title, startOpen = false } = {}) {
    const ids = sanitizeYoutubeVideoIds(videoIds);
    if (!ids.length) return null;
    return el("div", { class: "youtube-channel" },
      ...ids.map((id, index) => {
        const embedUrl = youtubeVideoEmbedUrl(id);
        if (!embedUrl) return null;
        const frame = el("div", { class: "youtube-channel-frame" });
        const mount = () => {
          if (frame.querySelector("iframe")) return;
          frame.replaceChildren(el("iframe", {
            src: embedUrl,
            title: title ? `${title} video ${index + 1}` : "YouTube video",
            allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
            referrerpolicy: "strict-origin-when-cross-origin",
            allowfullscreen: true,
          }));
        };
        if (startOpen) mount();
        else {
          frame.append(el("button", {
            class: "youtube-channel-play",
            type: "button",
            "aria-label": "Play YouTube video",
            style: `background-image:url("${youtubeVideoThumbUrl(id)}")`,
            onClick: () => mount(),
          },
            el("span", { class: "youtube-channel-play-icon", "aria-hidden": "true" }),
            el("span", {}, "Play")
          ));
        }
        return el("div", { class: "youtube-video" }, frame);
      })
    );
  }

  renderYoutubeMusicSection(p) {
    const id = parseYoutubePlaylistId(p.youtubePlaylistId);
    const draft = p.youtubePlaylistId || "";
    if (id && this.ytMusicList.playlistId !== id && !this.ytMusicList.loading) {
      queueMicrotask(() => this.loadYoutubePlaylist(id));
    }
    return this.profileSection("youtube-music", "YouTube Music",
      this.field("Public playlist", el("input", {
        value: draft,
        maxlength: "160",
        placeholder: "music.youtube.com/playlist?list=PL…",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": "YouTube Music playlist",
        onInput: (e) => {
          const next = parseYoutubePlaylistId(e.target.value) || e.target.value.trim();
          updateProfile({ youtubePlaylistId: next });
        },
        onChange: (e) => {
          const next = parseYoutubePlaylistId(e.target.value) || e.target.value.trim();
          const parsed = parseYoutubePlaylistId(next);
          const keep = parsed && parsed === this.ytMusicList.playlistId;
          updateProfile({
            youtubePlaylistId: next,
            youtubePlaylistThumb: keep ? getState().profile.youtubePlaylistThumb : "",
          });
          if (!keep) this.ytMusicList = { playlistId: "", videos: [], loading: false, error: "" };
          this.render();
        },
      })),
      el("p", { class: "hint" },
        draft && !id
          ? "Need a public playlist or album link (list=PL… or OLAK5uy…). Generated mixes and private playlists will not load."
          : "Optional. Paste a public playlist or album. Opening it on a profile loads YouTube."
      ),
      id ? this.youtubeMusicPreview(id) : null,
      { privacyField: "youtubePlaylistId" }
    );
  }

  youtubeMusicPreview(playlistId) {
    const catalog = this.ytMusicList.playlistId === playlistId
      ? this.ytMusicList
      : { videos: [], loading: true, error: "" };
    const list = el("div", { class: "youtube-pick-list", role: "list" });
    for (const video of catalog.videos.slice(0, 24)) {
      list.append(el("div", { class: "youtube-pick static" },
        el("img", {
          class: "youtube-pick-thumb",
          src: youtubeVideoThumbUrl(video.id),
          alt: "",
          loading: "lazy",
        }),
        el("span", { class: "youtube-pick-copy" },
          el("span", { class: "youtube-pick-title" }, video.title || video.id)
        )
      ));
    }
    return el("div", { class: "youtube-channel" },
      catalog.error ? el("p", { class: "disclaimer" }, catalog.error) : null,
      catalog.loading && !catalog.videos.length ? el("p", { class: "hint" }, "Loading playlist from YouTube…") : null,
      catalog.videos.length
        ? el("p", { class: "hint youtube-pick-count" },
          catalog.videos.length > 24
            ? `Public playlist · ${catalog.videos.length} tracks (showing 24)`
            : `Public playlist · ${catalog.videos.length} tracks`
        )
        : null,
      catalog.videos.length ? list : null
    );
  }

  async loadYoutubePlaylist(playlistId) {
    const id = parseYoutubePlaylistId(playlistId);
    if (!id || this.ytMusicList.loading) return;
    this.ytMusicList = { playlistId: id, videos: [], loading: true, error: "" };
    this.render();
    try {
      const data = await fetchPlaylistVideos(id, (partial) => {
        if (this.ytMusicList.playlistId !== id) return;
        this.ytMusicList = {
          playlistId: id,
          videos: (partial || []).map((item) => ({
            id: String(item.id || ""),
            title: String(item.title || ""),
          })),
          loading: true,
          error: "",
        };
        this.render();
      });
      const videos = [];
      const seen = new Set();
      for (const item of data.videos || []) {
        const videoId = String(item?.id || "");
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);
        videos.push({ id: videoId, title: String(item.title || "") });
      }
      this.ytMusicList = {
        playlistId: id,
        videos,
        loading: false,
        error: videos.length ? "" : "No public tracks found on that playlist.",
      };
      if (parseYoutubePlaylistId(getState().profile.youtubePlaylistId) === id && videos[0]?.id) {
        updateProfile({ youtubePlaylistThumb: videos[0].id });
      }
    } catch (err) {
      this.ytMusicList = {
        ...this.ytMusicList,
        playlistId: id,
        loading: false,
        error: err.message || "Could not load that playlist.",
      };
    }
    this.render();
  }

  youtubePlaylistViewer(playlistId, thumbId, { title, startOpen = false } = {}) {
    const id = parseYoutubePlaylistId(playlistId);
    const embedUrl = youtubePlaylistEmbedUrl(id);
    if (!embedUrl) return null;
    const frame = this.mediaFrame({
      src: embedUrl,
      title: title || "YouTube Music playlist",
      poster: youtubeVideoThumbUrl(thumbId),
      playLabel: "Play playlist",
      startOpen,
    });
    return el("div", { class: "youtube-channel" },
      el("h3", { class: "linkedin-card-kicker" }, "YouTube Music"),
      frame
    );
  }

  mediaFrame({ src, title, poster, playLabel, startOpen = false, height, playClass }) {
    const frame = el("div", {
      class: height ? "audio-frame" : "youtube-channel-frame",
      style: height ? `height:${height}px` : "",
    });
    const mount = () => {
      if (frame.querySelector("iframe")) return;
      frame.replaceChildren(el("iframe", {
        src,
        title: title || "Embedded player",
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        referrerpolicy: "strict-origin-when-cross-origin",
        allowfullscreen: true,
      }));
    };
    if (startOpen) mount();
    else {
      const posterUrl = String(poster || "").replace(/"/g, "");
      const extra = [!posterUrl ? "is-placeholder" : "", playClass].filter(Boolean).join(" ");
      frame.append(el("button", {
        class: `youtube-channel-play${extra ? ` ${extra}` : ""}`,
        type: "button",
        "aria-label": playLabel || "Play",
        style: posterUrl ? `background-image:url("${posterUrl}")` : "",
        onClick: () => mount(),
      },
        el("span", { class: "youtube-channel-play-icon", "aria-hidden": "true" }),
        el("span", {}, playLabel || "Play")
      ));
    }
    return frame;
  }

  featurePicker({ label, items, selectedIds, max, thumbOf, titleOf, detailOf, onChange, onRemove, className }) {
    const selected = new Set(selectedIds);
    const count = el("p", { class: "hint youtube-pick-count" },
      selected.size
        ? `${selected.size}${max ? ` of ${max}` : ""} selected for your profile`
        : "Tap what to show on your profile."
    );
    const drawCount = () => {
      count.textContent = selected.size
        ? `${selected.size}${max ? ` of ${max}` : ""} selected for your profile`
        : "Tap what to show on your profile.";
    };
    const list = el("div", { class: "youtube-pick-list", role: "listbox", "aria-label": label, "aria-multiselectable": "true" });
    const toggle = (id, row) => {
      if (selected.has(id)) selected.delete(id);
      else {
        if (max && selected.size >= max) return;
        selected.add(id);
      }
      row.classList.toggle("on", selected.has(id));
      row.setAttribute("aria-selected", selected.has(id) ? "true" : "false");
      onChange([...selected]);
      drawCount();
    };
    for (const item of items) {
      const id = item.id;
      const on = selected.has(id);
      const thumb = thumbOf?.(item);
      const row = el("div", {
        class: `youtube-pick ${on ? "on" : ""}`,
        role: "option",
        tabindex: "0",
        "aria-selected": on ? "true" : "false",
        onClick: () => toggle(id, row),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(id, row);
          }
        },
      },
        thumb
          ? el("img", {
            class: item.squareThumb ? "linkedin-pick-thumb" : "youtube-pick-thumb",
            src: thumb,
            alt: "",
            loading: "lazy",
            onError: (e) => {
              const img = e.currentTarget;
              img.replaceWith(el("span", {
                class: "linkedin-pick-kind",
                "aria-hidden": "true",
              }, String(titleOf(item) || "?").slice(0, 1)));
            },
          })
          : el("span", { class: "linkedin-pick-kind", "aria-hidden": "true" }, String(titleOf(item) || "?").slice(0, 1)),
        el("span", { class: "youtube-pick-copy" },
          el("span", { class: "youtube-pick-title" }, titleOf(item)),
          detailOf?.(item) ? el("span", { class: "youtube-pick-duration" }, detailOf(item)) : null
        ),
        onRemove
          ? el("button", {
            class: "linkedin-pick-remove",
            type: "button",
            "aria-label": `Remove ${titleOf(item)}`,
            onClick: (e) => {
              e.stopPropagation();
              onRemove(id);
            },
          }, "Remove")
          : null
      );
      list.append(row);
    }
    return el("div", { class: className || "linkedin-pick" }, count, items.length ? list : null);
  }

  mediaAddRow({ placeholder, ariaLabel, loading, onAdd }) {
    const input = el("input", {
      maxlength: "300",
      placeholder,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": ariaLabel,
      disabled: loading,
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onAdd(input.value);
        }
      },
    });
    return el("div", { class: "media-add-row" },
      input,
      el("button", {
        class: "btn",
        type: "button",
        disabled: loading,
        onClick: () => onAdd(input.value),
      }, loading ? "Adding…" : "Add")
    );
  }

  patchGithub(patch) {
    const current = sanitizeGithub(getState().profile.github);
    updateProfile({ github: { ...current, ...patch } });
  }

  githubRepoImageOf(login, repo) {
    if (repo?.image) {
      rememberGithubRepoImage(login, repo.name, repo.image);
      return repo.image;
    }
    return peekGithubRepoImage(login, repo?.name) || "";
  }

  persistGithubImages(login) {
    const id = parseGithubLogin(login);
    const current = sanitizeGithub(getState().profile.github);
    if (!id || parseGithubLogin(current.login) !== id) return;
    let changed = false;
    const repos = current.repos.map((repo) => {
      const image = peekGithubRepoImage(id, repo.name) || "";
      if (image && image !== repo.image) {
        changed = true;
        return { ...repo, image };
      }
      return repo;
    });
    if (changed) this.patchGithub({ repos });
  }

  rerenderGithubThumbs() {
    const mainTop = this.main.scrollTop;
    const list = this.main.querySelector(".github-picks .youtube-pick-list");
    const listTop = list?.scrollTop || 0;
    this.render();
    this.main.scrollTop = mainTop;
    const next = this.main.querySelector(".github-picks .youtube-pick-list");
    if (next) next.scrollTop = listTop;
  }

  ensureGithubImages(login, repos, persist) {
    const id = parseGithubLogin(login);
    if (!id) return;
    const unknown = (repos || []).filter((repo) => {
      if (!repo?.name) return false;
      if (repo.image) {
        rememberGithubRepoImage(id, repo.name, repo.image);
        return false;
      }
      if (peekGithubRepoImage(id, repo.name) !== null) return false;
      const key = `${id}/${repo.name}`.toLowerCase();
      if (this.ghThumbLoading.has(key)) return false;
      return true;
    });
    if (!unknown.length) return;
    if (persist) {
      const selected = new Set(sanitizeGithub(getState().profile.github).selected);
      unknown.sort((a, b) => Number(selected.has(b.name)) - Number(selected.has(a.name)));
    }
    for (const repo of unknown) this.ghThumbLoading.add(`${id}/${repo.name}`.toLowerCase());
    queueMicrotask(async () => {
      let dirty = 0;
      await fillGithubRepoImages(id, unknown, {
        onProgress: (_name, image) => {
          if (!image) return;
          dirty += 1;
          if (dirty % 3 !== 0) return;
          if (persist) this.persistGithubImages(id);
          this.rerenderGithubThumbs();
        },
      });
      for (const repo of unknown) this.ghThumbLoading.delete(`${id}/${repo.name}`.toLowerCase());
      if (persist) this.persistGithubImages(id);
      this.rerenderGithubThumbs();
    });
  }

  renderGithubSection(p) {
    const gh = sanitizeGithub(p.github);
    const login = parseGithubLogin(gh.login);
    const draft = gh.login || "";
    if (login && this.ghList.login !== login && !this.ghList.loading) {
      queueMicrotask(() => this.loadGithub(login));
    }
    const catalog = this.ghList.login === login ? this.ghList : { repos: gh.repos, loading: Boolean(login), error: "" };
    const byName = new Map();
    const withCard = (repo) => ({
      ...repo,
      id: repo.name,
      squareThumb: true,
      image: this.githubRepoImageOf(login, repo),
    });
    for (const repo of catalog.repos || []) byName.set(repo.name, withCard(repo));
    for (const repo of gh.repos) {
      const prev = byName.get(repo.name);
      if (prev) {
        byName.set(repo.name, withCard({ ...prev, image: prev.image || repo.image }));
      } else {
        byName.set(repo.name, withCard(repo));
      }
    }
    const items = [...byName.values()];
    if (login && items.length) this.ensureGithubImages(login, items, true);
    return this.profileSection("github", "GitHub",
      this.field("Public username", el("input", {
        value: draft,
        maxlength: "80",
        placeholder: "username or github.com/username",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": "GitHub username",
        onInput: (e) => this.patchGithub({ login: e.target.value.trim() }),
        onChange: (e) => {
          const next = e.target.value.trim();
          const parsed = parseGithubLogin(next);
          const keep = parsed && parsed === this.ghList.login;
          this.patchGithub({
            login: parsed || next,
            name: keep ? gh.name : "",
            bio: keep ? gh.bio : "",
            avatar: keep ? gh.avatar : "",
            repos: keep ? gh.repos : [],
            selected: keep ? gh.selected : [],
          });
          if (!keep) this.ghList = { login: "", repos: [], loading: false, error: "" };
          this.render();
        },
      })),
      el("p", { class: "hint" },
        draft && !login
          ? "Need a GitHub username, or paste github.com/name. We only list public repos."
          : "Optional. Tap public repos to feature. GitHub’s unauthenticated API allows about 60 loads per hour from this browser."
      ),
      this.ghList.error && this.ghList.login === login ? el("p", { class: "disclaimer" }, this.ghList.error) : null,
      catalog.loading && !items.length ? el("p", { class: "hint" }, "Loading public repos from GitHub…") : null,
      login && items.length
        ? this.featurePicker({
          className: "github-picks",
          label: "GitHub repositories",
          items,
          selectedIds: gh.selected,
          max: GITHUB_REPO_MAX,
          thumbOf: (repo) => repo.image,
          titleOf: (repo) => repo.name,
          detailOf: (repo) => [repo.demo ? "Live demo" : "", repo.fork ? "Fork" : "", repo.language, repo.stars ? `${repo.stars}★` : "", repo.description].filter(Boolean).join(" · "),
          onChange: (selected) => {
            const chosen = new Map(gh.repos.map((repo) => [repo.name, repo]));
            for (const name of selected) {
              const repo = byName.get(name);
              if (repo) chosen.set(name, repo);
            }
            this.patchGithub({
              selected,
              repos: [...chosen.values()].filter((repo) => selected.includes(repo.name)),
            });
          },
        })
        : null,
      { privacyField: "github" }
    );
  }

  async loadGithub(login) {
    const id = parseGithubLogin(login);
    if (!id || this.ghList.loading) return;
    this.ghList = { login: id, repos: [], loading: true, error: "" };
    this.render();
    try {
      const data = await fetchGithubProfile(id);
      if (parseGithubLogin(getState().profile.github?.login) !== id) return;
      this.ghList = { login: data.login, repos: data.repos, loading: false, error: data.repos.length ? "" : "No public repos on that account." };
      const current = sanitizeGithub(getState().profile.github);
      const keep = new Set(current.selected);
      const catalogByName = new Map(data.repos.map((repo) => [repo.name, repo]));
      this.patchGithub({
        login: data.login,
        name: data.name,
        bio: data.bio,
        avatar: data.avatar,
        repos: current.repos.filter((repo) => keep.has(repo.name)).map((repo) => {
          const fresh = catalogByName.get(repo.name);
          if (!fresh) return repo;
          return { ...fresh, image: repo.image || fresh.image };
        }),
      });
    } catch (err) {
      if (parseGithubLogin(getState().profile.github?.login) !== id) return;
      this.ghList = { login: id, repos: [], loading: false, error: err.message || "Could not load GitHub." };
    }
    this.render();
  }

  githubViewer(raw) {
    const gh = shareGithub(raw);
    if (!githubIsShown(gh)) return null;
    this.ensureGithubImages(gh.login, gh.repos, parseGithubLogin(getState().profile.github?.login) === gh.login);
    const url = githubProfileUrl(gh.login);
    const label = gh.name || gh.login;
    const photo = gh.avatar
      ? el("img", {
        class: "github-repo-thumb",
        src: gh.avatar,
        alt: "",
        onError: (e) => {
          const img = e.currentTarget;
          img.replaceWith(el("span", {
            class: "github-repo-thumb github-repo-letter",
            "aria-hidden": "true",
          }, String(label).slice(0, 1)));
        },
      })
      : el("span", { class: "github-repo-thumb github-repo-letter", "aria-hidden": "true" }, String(label).slice(0, 1));
    const card = el(url ? "a" : "div", {
      class: "github-repo-card github-user-card",
      href: url || undefined,
      target: url ? "_blank" : undefined,
      rel: url ? "noopener noreferrer" : undefined,
      "aria-label": url ? `Open ${label} on GitHub` : undefined,
    },
      photo,
      el("span", { class: "github-repo-copy" },
        el("span", { class: "linkedin-card-kicker" }, "GitHub"),
        el("span", { class: "github-repo-name" }, label),
        gh.bio ? el("span", { class: "github-repo-meta" }, gh.bio) : (gh.name ? el("span", { class: "github-repo-meta" }, gh.login) : null)
      )
    );
    return el("div", { class: "linkedin-card github-card" },
      card,
      el("div", { class: "github-repo-list" },
        ...gh.repos.map((repo) => {
          const image = this.githubRepoImageOf(gh.login, repo);
          const demo = repo.demo || "";
          const href = demo || repo.url;
          const thumb = image
            ? el("img", {
              class: "github-repo-thumb",
              src: image,
              alt: "",
              loading: "lazy",
              onError: (e) => {
                const img = e.currentTarget;
                img.replaceWith(el("span", {
                  class: "github-repo-thumb github-repo-letter",
                  "aria-hidden": "true",
                }, repo.name.slice(0, 1)));
              },
            })
            : el("span", { class: "github-repo-thumb github-repo-letter", "aria-hidden": "true" }, repo.name.slice(0, 1));
          const copy = el("span", { class: "github-repo-copy" },
            demo ? el("span", { class: "linkedin-card-kicker" }, "Live demo") : null,
            el("span", { class: "github-repo-name" }, repo.name),
            el("span", { class: "github-repo-meta" },
              [repo.language, repo.stars ? `${repo.stars}★` : "", repo.description].filter(Boolean).join(" · ")
            )
          );
          return el("div", { class: "github-repo-card" },
            el("a", {
              class: "github-repo-main",
              href,
              target: "_blank",
              rel: "noopener noreferrer",
              "aria-label": demo ? `Open ${repo.name} live demo` : `Open ${repo.name} on GitHub`,
            }, thumb, copy),
            demo
              ? el("a", {
                class: "github-repo-source",
                href: repo.url,
                target: "_blank",
                rel: "noopener noreferrer",
                "aria-label": `Open ${repo.name} on GitHub`,
              }, "GitHub")
              : null
          );
        })
      )
    );
  }

  patchBandcamp(next) {
    updateProfile({ bandcamp: sanitizeBandcamp(next) });
  }

  renderBandcampSection(p) {
    const bc = sanitizeBandcamp(p.bandcamp);
    return this.profileSection("bandcamp", "Bandcamp",
      el("p", { class: "hint" },
        `Optional. Paste an album or track URL. For a player, also paste Bandcamp’s Share → Embed code (it includes album= or track=). Up to ${BANDCAMP_ITEM_MAX}.`
      ),
      this.mediaAddRow({
        placeholder: "artist.bandcamp.com/album/… or embed code",
        ariaLabel: "Bandcamp album or track",
        onAdd: (value) => this.addBandcamp(value),
      }),
      this.bcAdd.error ? el("p", { class: "disclaimer" }, this.bcAdd.error) : null,
      bc.items.length
        ? this.featurePicker({
          label: "Bandcamp releases",
          items: bc.items,
          selectedIds: bc.selected,
          titleOf: (item) => item.title || item.kind,
          detailOf: (item) => [item.artist, item.kind, item.embedId ? "Player" : "Link"].filter(Boolean).join(" · "),
          onChange: (selected) => this.patchBandcamp({ ...bc, selected }),
          onRemove: (id) => {
            this.patchBandcamp(removeBandcampItem(getState().profile.bandcamp, id));
            this.render();
          },
        })
        : null,
      { privacyField: "bandcamp" }
    );
  }

  addBandcamp(value) {
    try {
      this.patchBandcamp(addBandcampItem(getState().profile.bandcamp, value));
      this.bcAdd = { error: "" };
    } catch (err) {
      this.bcAdd = { error: err.message || "Could not add that Bandcamp link." };
    }
    this.render();
  }

  bandcampViewer(raw) {
    const bc = shareBandcamp(raw);
    if (!bandcampIsShown(bc)) return null;
    return el("div", { class: "linkedin-card" },
      el("h3", { class: "linkedin-card-kicker" }, "Bandcamp"),
      ...bc.items.map((item) => {
        const embed = bandcampEmbedUrl(item);
        return el("div", { class: "youtube-video" },
          embed
            ? this.mediaFrame({
              src: embed,
              title: item.title || "Bandcamp",
              playLabel: "Play on Bandcamp",
              height: 120,
            })
            : null,
          el("p", { class: "linkedin-item" },
            el("strong", {}, item.title || "Bandcamp"),
            item.artist ? el("span", {}, item.artist) : null
          ),
          el("a", {
            class: "youtube-channel-link",
            href: item.url,
            target: "_blank",
            rel: "noopener noreferrer",
          }, "Open on Bandcamp")
        );
      })
    );
  }

  patchSoundCloud(next) {
    updateProfile({ soundcloud: sanitizeSoundCloud(next) });
  }

  renderSoundCloudSection(p) {
    const sc = sanitizeSoundCloud(p.soundcloud);
    return this.profileSection("soundcloud", "SoundCloud",
      el("p", { class: "hint" },
        `Optional. Paste a public track, playlist, or profile URL. Opening a player loads SoundCloud. Up to ${SOUNDCLOUD_ITEM_MAX}.`
      ),
      this.mediaAddRow({
        placeholder: "soundcloud.com/artist/track",
        ariaLabel: "SoundCloud URL",
        loading: this.scAdd.loading,
        onAdd: (value) => this.addSoundCloud(value),
      }),
      this.scAdd.error ? el("p", { class: "disclaimer" }, this.scAdd.error) : null,
      sc.items.length
        ? this.featurePicker({
          className: "soundcloud-picks",
          label: "SoundCloud links",
          items: sc.items.map((item) => ({ ...item, squareThumb: true })),
          selectedIds: sc.selected,
          thumbOf: (item) => item.thumbnail || SOUNDCLOUD_PLACEHOLDER,
          titleOf: (item) => item.title,
          detailOf: (item) => [item.author, item.kind].filter(Boolean).join(" · "),
          onChange: (selected) => this.patchSoundCloud({ ...sc, selected }),
          onRemove: (id) => {
            this.patchSoundCloud(removeSoundCloudItem(getState().profile.soundcloud, id));
            this.render();
          },
        })
        : null,
      { privacyField: "soundcloud" }
    );
  }

  async addSoundCloud(value) {
    if (this.scAdd.loading) return;
    if (!parseSoundCloudUrl(value) && !String(value || "").trim()) return;
    this.scAdd = { loading: true, error: "" };
    this.render();
    try {
      const next = await addSoundCloudItem(getState().profile.soundcloud, value);
      this.patchSoundCloud(next);
      this.scAdd = { loading: false, error: "" };
    } catch (err) {
      this.scAdd = { loading: false, error: err.message || "Could not add that SoundCloud link." };
    }
    this.render();
  }

  soundcloudViewer(raw) {
    const sc = shareSoundCloud(raw);
    if (!soundcloudIsShown(sc)) return null;
    return el("div", { class: "linkedin-card" },
      el("h3", { class: "linkedin-card-kicker" }, "SoundCloud"),
      ...sc.items.map((item) => {
        const embed = soundcloudEmbedUrl(item.url);
        return embed
          ? this.mediaFrame({
            src: embed,
            title: item.title || "SoundCloud",
            poster: item.thumbnail || SOUNDCLOUD_PLACEHOLDER,
            playClass: item.thumbnail ? "" : "soundcloud-placeholder",
            playLabel: "Play on SoundCloud",
            height: soundcloudEmbedHeight(item.kind),
          })
          : null;
      })
    );
  }

  patchLinkedIn(patch) {
    const current = sanitizeLinkedIn(getState().profile.linkedin);
    updateProfile({ linkedin: { ...current, ...patch } });
  }

  renderLinkedInSection(p) {
    const li = sanitizeLinkedIn(p.linkedin);
    const handle = parseLinkedInHandle(li.handle);
    const draft = li.handle || "";
    if (handle && this.liBadge.handle !== handle && !this.liBadge.loading) {
      queueMicrotask(() => this.loadLinkedInBadge(handle));
    }
    const input = el("input", {
      type: "file",
      accept: ".zip,.csv,application/zip,text/csv",
      multiple: true,
      hidden: true,
      "aria-label": "LinkedIn data archive",
      onChange: (e) => {
        this.importLinkedInFiles(e.target.files);
        e.target.value = "";
      },
    });
    return this.profileSection("linkedin", "LinkedIn",
      el("p", { class: "hint" },
        "This site cannot use your LinkedIn login. Sign in with LinkedIn only returns name and photo, not jobs, schools, or projects. On LinkedIn, download Profile, Positions, Education, and Projects, import that zip, then tap what each network can see."
      ),
      el("div", { class: "linkedin-import" },
        el("a", {
          class: "btn secondary",
          href: LINKEDIN_DATA_DOWNLOAD_URL,
          target: "_blank",
          rel: "noopener noreferrer",
        }, "Open LinkedIn download"),
        el("button", {
          class: "btn",
          type: "button",
          disabled: this.liImport.loading,
          onClick: () => input.click(),
        }, this.liImport.loading ? "Importing…" : "Import archive"),
        input
      ),
      this.field("Public profile", el("input", {
        value: draft,
        maxlength: "160",
        placeholder: "handle or linkedin.com/in/handle",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": "LinkedIn profile",
        onInput: (e) => this.patchLinkedIn({ handle: e.target.value.trim() }),
        onChange: (e) => {
          const next = e.target.value.trim();
          const parsed = parseLinkedInHandle(next);
          const keep = parsed && parsed === this.liBadge.handle;
          const current = sanitizeLinkedIn(getState().profile.linkedin);
          this.patchLinkedIn({
            handle: parsed || next,
            photo: keep || !parsed ? current.photo : "",
          });
          if (!keep) this.liBadge = { handle: "", data: null, loading: false, error: "" };
          this.render();
        },
      })),
      draft && !handle
        ? el("p", { class: "hint" }, "Need a LinkedIn handle, or paste a linkedin.com/in/… link.")
        : null,
      this.liImport.error ? el("p", { class: "disclaimer" }, this.liImport.error) : null,
      this.liImport.note ? el("p", { class: "hint" }, this.liImport.note) : null,
      linkedInHasDraft(li) ? this.linkedinEditor(li) : null,
      { privacyField: "linkedin" }
    );
  }

  linkedinEditor(li) {
    return el("div", { class: "linkedin-editor" },
      this.field("Name", el("input", {
        value: li.name,
        maxlength: "80",
        placeholder: "As shown on LinkedIn",
        autocomplete: "off",
        onInput: (e) => this.patchLinkedIn({ name: e.target.value }),
        onChange: () => this.render(),
      })),
      this.field("Headline", el("input", {
        value: li.headline,
        maxlength: "180",
        placeholder: "Job title or one-line bio",
        autocomplete: "off",
        onInput: (e) => this.patchLinkedIn({ headline: e.target.value }),
        onChange: () => this.render(),
      })),
      this.linkedinPicker(li),
      this.linkedinAddForm("experience", li.experience.length),
      this.linkedinAddForm("education", li.education.length),
      this.linkedinAddForm("projects", li.projects.length)
    );
  }

  linkedinPicker(li) {
    const selected = new Set(li.selected);
    const count = el("p", { class: "hint youtube-pick-count" },
      selected.size
        ? `${selected.size} selected for your profile`
        : "Tap what to show on your profile."
    );
    const drawCount = () => {
      count.textContent = selected.size
        ? `${selected.size} selected for your profile`
        : "Tap what to show on your profile.";
    };
    const list = el("div", { class: "youtube-pick-list", role: "listbox", "aria-label": "LinkedIn fields", "aria-multiselectable": "true" });
    const toggle = (key, row) => {
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      row.classList.toggle("on", selected.has(key));
      row.setAttribute("aria-selected", selected.has(key) ? "true" : "false");
      this.patchLinkedIn({ selected: [...selected] });
      drawCount();
    };
    const addRow = (key, title, detail, thumb, onRemove) => {
      const on = selected.has(key);
      const row = el("div", {
        class: `youtube-pick ${on ? "on" : ""}`,
        role: "option",
        tabindex: "0",
        "aria-selected": on ? "true" : "false",
        onClick: () => toggle(key, row),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(key, row);
          }
        },
      },
        thumb
          ? el("img", {
            class: "linkedin-pick-thumb",
            src: thumb,
            alt: "",
            onError: (e) => e.currentTarget.remove(),
          })
          : el("span", { class: "linkedin-pick-kind", "aria-hidden": "true" }, title.slice(0, 1)),
        el("span", { class: "youtube-pick-copy" },
          el("span", { class: "youtube-pick-title" }, title),
          detail ? el("span", { class: "youtube-pick-duration" }, detail) : null
        ),
        onRemove
          ? el("button", {
            class: "linkedin-pick-remove",
            type: "button",
            "aria-label": `Remove ${title}`,
            onClick: (e) => {
              e.stopPropagation();
              onRemove();
            },
          }, "Remove")
          : null
      );
      list.append(row);
    };
    addRow("handle", "Profile link", linkedInProfileUrl(li.handle));
    if (li.photo) addRow("photo", "Photo", "From LinkedIn", li.photo);
    if (li.name) addRow("name", "Name", li.name);
    if (li.headline) addRow("headline", "Headline", li.headline);
    for (const item of li.experience) {
      addRow(
        `exp:${item.id}`,
        item.title || item.org || "Role",
        [item.org && item.title ? item.org : "", item.dates].filter(Boolean).join(" · "),
        "",
        () => this.removeLinkedInItem("experience", item.id)
      );
    }
    for (const item of li.education) {
      addRow(
        `edu:${item.id}`,
        item.school || item.degree || "School",
        [item.degree, item.dates].filter(Boolean).join(" · "),
        "",
        () => this.removeLinkedInItem("education", item.id)
      );
    }
    for (const item of li.projects) {
      addRow(
        `proj:${item.id}`,
        item.name || "Project",
        item.summary,
        "",
        () => this.removeLinkedInItem("projects", item.id)
      );
    }
    return el("div", { class: "linkedin-pick" }, count, list);
  }

  linkedinAddForm(kind, count) {
    if (count >= LINKEDIN_ITEM_MAX) {
      return el("p", { class: "hint" }, `Up to ${LINKEDIN_ITEM_MAX} ${kind} on this profile.`);
    }
    const specs = {
      experience: {
        label: "Add a role",
        fields: [
          { key: "title", placeholder: "Title", max: 80 },
          { key: "org", placeholder: "Organization", max: 80 },
          { key: "dates", placeholder: "Dates", max: 40 },
        ],
        list: "experience",
        prefix: "e",
        valid: (v) => v.title || v.org,
      },
      education: {
        label: "Add a school",
        fields: [
          { key: "school", placeholder: "School", max: 80 },
          { key: "degree", placeholder: "Degree or field", max: 80 },
          { key: "dates", placeholder: "Dates", max: 40 },
        ],
        list: "education",
        prefix: "u",
        valid: (v) => v.school || v.degree,
      },
      projects: {
        label: "Add a project",
        fields: [
          { key: "name", placeholder: "Project name", max: 80 },
          { key: "summary", placeholder: "One-line summary", max: 240 },
        ],
        list: "projects",
        prefix: "p",
        valid: (v) => v.name || v.summary,
      },
    };
    const spec = specs[kind];
    const inputs = spec.fields.map((field) => el("input", {
      placeholder: field.placeholder,
      maxlength: String(field.max),
      autocomplete: "off",
      "aria-label": field.placeholder,
    }));
    const add = () => {
      const values = {};
      spec.fields.forEach((field, i) => {
        values[field.key] = inputs[i].value.trim();
      });
      if (!spec.valid(values)) return;
      const current = sanitizeLinkedIn(getState().profile.linkedin);
      this.patchLinkedIn({
        [spec.list]: [...current[spec.list], { id: newLinkedInItemId(spec.prefix), ...values }],
      });
      this.render();
    };
    return el("div", { class: "linkedin-add" },
      el("p", { class: "linkedin-add-label" }, spec.label),
      el("div", { class: "linkedin-add-row" },
        ...inputs,
        el("button", { class: "btn secondary", type: "button", onClick: add }, "Add")
      )
    );
  }

  removeLinkedInItem(list, id) {
    const current = sanitizeLinkedIn(getState().profile.linkedin);
    const prefix = list === "experience" ? "exp" : list === "education" ? "edu" : "proj";
    this.patchLinkedIn({
      [list]: current[list].filter((item) => item.id !== id),
      selected: current.selected.filter((key) => key !== `${prefix}:${id}`),
    });
    this.render();
  }

  async importLinkedInFiles(fileList) {
    if (!fileList?.length) return;
    this.liImport = { loading: true, error: "", note: "" };
    this.render();
    try {
      const imported = await importLinkedInArchive(fileList);
      const current = sanitizeLinkedIn(getState().profile.linkedin);
      this.patchLinkedIn({
        handle: imported.handle || current.handle,
        name: imported.name || current.name,
        headline: imported.headline || current.headline,
        experience: imported.experience.length ? imported.experience : current.experience,
        education: imported.education.length ? imported.education : current.education,
        projects: imported.projects.length ? imported.projects : current.projects,
        selected: [],
      });
      this.profileOpen.add("linkedin");
      this.liImport = {
        loading: false,
        error: "",
        note: linkedInImportSummary(imported),
      };
    } catch (err) {
      this.liImport = {
        loading: false,
        error: err.message || "Could not import that LinkedIn archive.",
        note: "",
      };
    }
    this.render();
  }

  async loadLinkedInBadge(handle) {
    const id = parseLinkedInHandle(handle);
    if (!id || this.liBadge.loading) return;
    this.liBadge = { handle: id, data: null, loading: true, error: "" };
    try {
      const data = await fetchLinkedInBadge(id);
      if (parseLinkedInHandle(getState().profile.linkedin?.handle) !== id) return;
      this.liBadge = { handle: id, data, loading: false, error: "" };
      const current = sanitizeLinkedIn(getState().profile.linkedin);
      this.patchLinkedIn({
        name: data.name || current.name,
        headline: data.headline || current.headline,
        photo: data.photo || current.photo,
      });
      this.render();
    } catch {
      if (parseLinkedInHandle(getState().profile.linkedin?.handle) !== id) return;
      this.liBadge = { handle: id, data: null, loading: false, error: "" };
    }
  }

  linkedinViewer(raw) {
    const li = shareLinkedIn(raw);
    if (!linkedInIsShown(li)) return null;
    const url = linkedInProfileUrl(li.handle);
    const item = (title, detail) => el(url ? "a" : "div", {
      class: "linkedin-item-card",
      href: url || undefined,
      target: url ? "_blank" : undefined,
      rel: url ? "noopener noreferrer" : undefined,
      "aria-label": url ? `Open ${title} on LinkedIn` : undefined,
    },
      el("span", { class: "linkedin-item-letter", "aria-hidden": "true" }, String(title || "?").slice(0, 1)),
      el("span", { class: "github-repo-copy" },
        el("span", { class: "github-repo-name" }, title),
        detail ? el("span", { class: "github-repo-meta" }, detail) : null
      )
    );
    const head = (li.photo || li.name || li.headline)
      ? el(url ? "a" : "div", {
        class: url ? "linkedin-item-card linkedin-profile-card" : "linkedin-card-head",
        href: url || undefined,
        target: url ? "_blank" : undefined,
        rel: url ? "noopener noreferrer" : undefined,
        "aria-label": url ? `Open ${li.name || "LinkedIn profile"} on LinkedIn` : undefined,
      },
        li.photo ? el("img", {
          class: "github-repo-thumb",
          src: li.photo,
          alt: "",
          onError: (e) => e.currentTarget.remove(),
        }) : el("span", { class: "linkedin-item-letter", "aria-hidden": "true" }, String(li.name || "L").slice(0, 1)),
        el("span", { class: "github-repo-copy" },
          li.name ? el("span", { class: "github-repo-name" }, li.name) : null,
          li.headline ? el("span", { class: "github-repo-meta" }, li.headline) : null
        )
      )
      : null;
    return el("div", { class: "linkedin-card" },
      el("h3", { class: "linkedin-card-kicker" }, "LinkedIn"),
      head,
      li.experience.length
        ? el("div", { class: "linkedin-group" },
          el("h4", {}, "Experience"),
          ...li.experience.map((row) => item(
            row.title || row.org,
            [row.title && row.org ? row.org : "", row.dates].filter(Boolean).join(" · ")
          ))
        )
        : null,
      li.education.length
        ? el("div", { class: "linkedin-group" },
          el("h4", {}, "Education"),
          ...li.education.map((row) => item(
            row.school || row.degree,
            [row.degree && row.school ? row.degree : "", row.dates].filter(Boolean).join(" · ")
          ))
        )
        : null,
      li.projects.length
        ? el("div", { class: "linkedin-group" },
          el("h4", {}, "Projects"),
          ...li.projects.map((row) => item(row.name || "Project", row.summary))
        )
        : null
    );
  }

  ensureLookingForEnabled(profile) {
    if (!this.lookingForEnabled) this.lookingForEnabled = new Set();
    for (const id of lookingForIntentIds(profile)) this.lookingForEnabled.add(id);
    return this.lookingForEnabled;
  }

  setLookingForEnabled(next) {
    const nextSet = new Set(next);
    const prev = this.lookingForEnabled || new Set();
    const patch = {};
    if (prev.has("relationships") && !nextSet.has("relationships")) {
      patch.seekingRelationships = [];
    }
    if (prev.has("friendships") && !nextSet.has("friendships")) {
      patch.seekingFriendships = [];
    }
    if (prev.has("networking") && !nextSet.has("networking")) {
      patch.networking = [];
    }
    if (prev.has("musician-seeking-band") && !nextSet.has("musician-seeking-band")) {
      patch.musicianInstruments = [];
      patch.musicianSeekingBand = [];
    }
    if (prev.has("band-seeking-musician") && !nextSet.has("band-seeking-musician")) {
      patch.bandSeekingMusician = [];
    }
    this.lookingForEnabled = nextSet;
    if (Object.keys(patch).length) updateProfile(patch);
    queueMicrotask(() => this.render());
  }

  renderLookingForSection(p) {
    const enabled = this.ensureLookingForEnabled(p);
    const details = [];
    if (enabled.has("relationships")) {
      details.push(el("div", { class: "field looking-for-detail relationships" },
        el("label", {}, "Relationships"),
        el("p", { class: "hint" }, "Who you want to date."),
        this.chipGroup(
          GENDER_SEEK_OPTIONS,
          p.seekingRelationships,
          (next) => {
            const wasDating = hasRelationshipIntent(getState().profile);
            updateProfile({ seekingRelationships: next });
            if (wasDating !== next.length > 0) queueMicrotask(() => this.render());
          }
        )
      ));
    }
    if (enabled.has("friendships")) {
      details.push(el("div", { class: "field looking-for-detail friendships" },
        el("label", {}, "Friendships"),
        el("p", { class: "hint" }, "Who you want to be friends with."),
        this.chipGroup(
          GENDER_SEEK_OPTIONS,
          p.seekingFriendships,
          (next) => updateProfile({ seekingFriendships: next })
        )
      ));
    }
    if (enabled.has("networking")) {
      details.push(el("div", { class: "field looking-for-detail networking" },
        el("label", {}, "Networking"),
        el("p", { class: "hint" }, "General, hiring, job seeking, and new opportunities."),
        this.chipGroup(
          NETWORKING_INTENTS,
          p.networking,
          (next) => updateProfile({ networking: next })
        )
      ));
    }
    if (enabled.has("musician-seeking-band")) {
      details.push(el("div", { class: "field looking-for-detail musician-seeking-band" },
        el("label", {}, "Join a band"),
        el("p", { class: "hint" }, "Instruments you play. Type to search. Add your own only if it is missing."),
        this.chipGroupWithCustom(
          MUSIC_INSTRUMENTS,
          p.musicianInstruments,
          (next) => updateProfile({ musicianInstruments: next }),
          { listKey: "musicianInstruments" }
        ),
        el("p", { class: "hint" }, "Genres you want to play. Type to search. Add your own only if it is missing."),
        this.chipGroupWithCustom(
          MUSIC_GENRES,
          p.musicianSeekingBand,
          (next) => updateProfile({ musicianSeekingBand: next }),
          { listKey: "musicianSeekingBand" }
        )
      ));
    }
    if (enabled.has("band-seeking-musician")) {
      details.push(el("div", { class: "field looking-for-detail band-seeking-musician" },
        el("label", {}, "Find musicians"),
        el("p", { class: "hint" }, "Instruments you want in the band. Type to search. Add your own only if it is missing."),
        this.chipGroupWithCustom(
          MUSIC_INSTRUMENTS,
          p.bandSeekingMusician,
          (next) => updateProfile({ bandSeekingMusician: next }),
          { listKey: "bandSeekingMusician" }
        )
      ));
    }
    return this.profileSection("looking", "What you are looking for",
      el("p", { class: "hint" }, "Turn on at least one. You only see people who overlap with you. Looking-for types are public by default so others can match with you."),
      el("div", { class: "field" },
        this.chipGroup(
          LOOKING_FOR_OPTIONS,
          [...enabled],
          (next) => this.setLookingForEnabled(next),
          { classFor: (opt, on) => (on ? `intent ${opt.id}` : ""), privacyField: "lookingFor", privacyAlways: true }
        )
      ),
      ...details
    );
  }

  profileSection(id, title, ...bodyChildren) {
    const open = this.profileOpen.has(id);
    const bodyId = `profile-section-${id}`;
    let privacy = null;
    if (bodyChildren.length && bodyChildren[bodyChildren.length - 1]?.privacyField) {
      privacy = bodyChildren.pop();
    }
    const body = el("div", {
      class: "section-body stack-col",
      id: bodyId,
      hidden: !open,
    }, ...bodyChildren);
    const toggle = el("button", {
      class: "section-toggle",
      type: "button",
      "aria-expanded": String(open),
      "aria-controls": bodyId,
      onClick: (e) => {
        const panel = e.currentTarget.closest(".profile-section");
        this.setProfileSectionOpen(id, !this.profileOpen.has(id), panel);
      },
    },
      el("span", { class: "section-toggle-label" }, title),
      el("span", { class: "section-chevron", "aria-hidden": "true" })
    );
    const handle = el("button", {
      class: "section-drag",
      type: "button",
      "aria-label": `Reorder ${title}`,
      title: "Drag to reorder",
      onPointerDown: (e) => {
        if (e.button != null && e.button !== 0) return;
        const panel = e.currentTarget.closest(".profile-section");
        const list = e.currentTarget.closest(".profile-sections");
        if (panel && list) this.beginProfileReorder(list, panel, e);
      },
      onKeyDown: (e) => this.moveProfileSection(e),
    });
    handle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="5" cy="3" r="1.4" fill="currentColor"/><circle cx="11" cy="3" r="1.4" fill="currentColor"/><circle cx="5" cy="8" r="1.4" fill="currentColor"/><circle cx="11" cy="8" r="1.4" fill="currentColor"/><circle cx="5" cy="13" r="1.4" fill="currentColor"/><circle cx="11" cy="13" r="1.4" fill="currentColor"/></svg>';
    return el("section", {
      class: `panel stack-col profile-section${open ? " is-open" : ""}`,
      role: "listitem",
      dataset: { section: id },
    },
      el("h2", { class: "section-heading" },
        handle,
        toggle,
        privacy ? this.privacyLock(privacy.privacyField, privacy.privacyItem, title) : null
      ),
      body
    );
  }

  moveProfileSection(e) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const panel = e.currentTarget.closest(".profile-section");
    const list = e.currentTarget.closest(".profile-sections");
    if (!panel || !list) return;
    const target = e.key === "ArrowUp" ? panel.previousElementSibling : panel.nextElementSibling;
    if (!target?.classList.contains("profile-section")) return;
    e.preventDefault();
    if (e.key === "ArrowUp") list.insertBefore(panel, target);
    else list.insertBefore(target, panel);
    this.commitProfileOrder(list);
    e.currentTarget.focus();
  }

  beginProfileReorder(list, panel, e) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const rect = panel.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    this.profileDragging = true;
    this.profileRenderQueued = false;
    const placeholder = el("div", { class: "profile-section-placeholder", "aria-hidden": "true" });
    placeholder.style.height = `${rect.height}px`;
    panel.after(placeholder);
    document.body.append(panel);
    panel.classList.add("is-dragging");
    panel.style.width = `${rect.width}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    document.body.classList.add("is-reordering");
    const place = (clientY) => {
      panel.style.top = `${clientY - offsetY}px`;
      const items = [...list.children].filter((node) => node !== panel && node !== placeholder);
      let placed = false;
      for (const item of items) {
        const box = item.getBoundingClientRect();
        if (clientY < box.top + box.height / 2) {
          list.insertBefore(placeholder, item);
          placed = true;
          break;
        }
      }
      if (!placed) list.append(placeholder);
      const scroller = this.main;
      const bounds = scroller.getBoundingClientRect();
      if (clientY < bounds.top + 56) scroller.scrollTop -= 18;
      else if (clientY > bounds.bottom - 72) scroller.scrollTop += 18;
    };
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      place(ev.clientY);
    };
    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      try { handle.releasePointerCapture(pointerId); } catch {}
      placeholder.replaceWith(panel);
      panel.classList.remove("is-dragging");
      panel.style.width = "";
      panel.style.left = "";
      panel.style.top = "";
      document.body.classList.remove("is-reordering");
      this.profileDragging = false;
      this.commitProfileOrder(list);
      if (this.profileRenderQueued) this.render();
    };
    try { handle.setPointerCapture(pointerId); } catch {}
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  commitProfileOrder(list) {
    const visible = [...list.querySelectorAll(":scope > .profile-section")]
      .map((node) => node.dataset.section)
      .filter(Boolean);
    const next = applySectionOrder(getState().profile.sectionOrder, visible);
    if (next.join("\0") === sanitizeSectionOrder(getState().profile.sectionOrder).join("\0")) return;
    updateProfile({ sectionOrder: next });
    this.publishProfile();
  }

  setProfileSectionOpen(id, open, panel) {
    if (open) this.profileOpen.add(id);
    else this.profileOpen.delete(id);
    if (!panel) return;
    panel.classList.toggle("is-open", open);
    const body = panel.querySelector(".section-body");
    const toggle = panel.querySelector(".section-toggle");
    if (body) body.hidden = !open;
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
  }

  setAllProfileSections(open, root) {
    for (const panel of root.querySelectorAll(".profile-section")) {
      this.setProfileSectionOpen(panel.dataset.section, open, panel);
    }
  }

  beginLink() {
    if (this.linkBusy || !this.linkPending) return;
    this.linkBusy = true;
    this.linkError = "";
    const vault = new VaultNet({
      onStatus: (text) => {
        this.statusText = text;
        if (this.statusEl?.isConnected) this.statusEl.textContent = text;
      },
    });
    vault.pair({ ...this.linkPending })
      .then(() => {
        this.linkPending = null;
        location.reload();
      })
      .catch((err) => {
        this.linkBusy = false;
        this.linkError = err.message || "Could not link this browser.";
        this.render();
      });
  }

  startVaultSync() {
    if (this.vaultNet || !getLinkedVault()) return;
    this.vaultNet = new VaultNet({
      onMerged: () => {
        this.render();
      },
    });
    this.vaultNet.startSync().catch(() => {});
  }

  renderLinking() {
    this.statusEl = el("p", { class: "lede", "aria-live": "polite" }, this.statusText || "Connecting to desktop…");
    return el("section", { class: "panel stack-col" },
      el("h1", {}, "Link this browser"),
      this.statusEl,
      this.linkError ? el("p", { class: "disclaimer" }, this.linkError) : null,
      el("p", { class: "hint" }, "Keep Local Chat Vault open. This browser will share all identities with the desktop vault."),
      this.linkError ? el("button", {
        class: "btn",
        type: "button",
        onClick: () => {
          this.linkError = "";
          this.beginLink();
          this.render();
        },
      }, "Try again") : null,
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.linkPending = null;
          this.linkBusy = false;
          this.linkNeedsChoice = false;
          this.linkChoice = "";
          this.render();
        },
      }, "Cancel")
    );
  }

  field(label, control, privacy) {
    const head = el("div", { class: "field-head" },
      el("label", {}, label),
      privacy ? this.privacyLock(privacy.field, privacy.item, label) : null
    );
    return el("div", { class: "field" }, head, control);
  }

  privacyLock(field, item, name) {
    const level = fieldPrivacy(getState().profile, field, item);
    const letter = el("span", { class: "privacy-lock-letter" }, privacyLetter(level));
    const icon = el("span", { class: "privacy-lock-icon", "aria-hidden": "true" });
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V6zm7 12H9v-6h8v6z"/></svg>';
    const label = el("label", {
      class: `privacy-lock privacy-${level}`,
      title: `Who can see ${name}`,
    },
      icon,
      letter,
      el("select", {
        "aria-label": `Who can see ${name}`,
        onClick: (e) => e.stopPropagation(),
        onMouseDown: (e) => e.stopPropagation(),
        onChange: (e) => {
          e.stopPropagation();
          const next = e.target.value;
          updateProfile({ privacy: withFieldPrivacy(getState().profile.privacy, field, item, next) });
          label.className = `privacy-lock privacy-${next}`;
          letter.textContent = privacyLetter(next);
          this.publishProfile();
        },
      },
        ...PRIVACY_LEVELS.map((o) => el("option", {
          value: o.id,
          selected: o.id === level,
        }, o.label))
      )
    );
    return label;
  }

  wrapChip(chip, { on, privacyField, privacyValue, privacyName, always } = {}) {
    if (!privacyField || (!on && !always)) return chip;
    return el("div", { class: "chip-with-lock" },
      chip,
      this.privacyLock(privacyField, privacyValue, privacyName || privacyValue)
    );
  }

  select(options, value, onChange, { blank = true } = {}) {
    const sel = el("select", {
      onChange: (e) => onChange(e.target.value),
    },
      blank ? el("option", { value: "" }, "Choose…") : null,
      ...options.map((o) => el("option", { value: o.id, selected: o.id === value }, o.label))
    );
    return sel;
  }

  chipGroup(options, selected, onChange, { classFor, privacyField, privacyAlways } = {}) {
    const set = new Set(selected || []);
    const box = el("div", { class: "chips" });
    const chipClass = (opt) => {
      const on = set.has(opt.id);
      const extra = classFor ? classFor(opt, on) : "";
      return ["chip", on ? "on" : "", extra].filter(Boolean).join(" ");
    };
    const redraw = () => {
      clear(box);
      for (const opt of options) {
        const on = set.has(opt.id);
        const chip = el("button", {
          class: chipClass(opt),
          type: "button",
          onClick: () => {
            if (opt.id === "everyone") {
              if (set.has("everyone")) set.clear();
              else {
                set.clear();
                set.add("everyone");
              }
            } else {
              set.delete("everyone");
              if (set.has(opt.id)) set.delete(opt.id);
              else set.add(opt.id);
            }
            onChange([...set]);
            redraw();
          },
        }, opt.label);
        box.append(this.wrapChip(chip, {
          on,
          privacyField,
          privacyValue: opt.id,
          privacyName: opt.label,
          always: privacyAlways,
        }));
      }
    };
    redraw();
    return box;
  }

  chipGroupWithCustom(options, selected, onChange, { placeholder = "Search or add your own", listKey } = {}) {
    const set = new Set(selected || []);
    const known = new Set(options.map((o) => o.id));
    const wrap = el("div", { class: "stack-col" });
    const box = el("div", { class: "chips pick-list" });
    const hint = el("p", { class: "hint pick-list-hint", "aria-live": "polite" });
    const redraw = () => {
      const query = custom.value;
      const visible = matchingOptions(options, query);
      const customSelected = [...set].filter((id) => !known.has(id));
      const visibleCustom = matchingTags(customSelected, query);
      const selectedOpts = visible.filter((opt) => set.has(opt.id));
      const unselectedOpts = visible.filter((opt) => !set.has(opt.id));
      clear(box);
      const appendOption = (opt) => {
        const on = set.has(opt.id);
        box.append(el("button", {
          class: `chip ${on ? "on" : ""}`,
          type: "button",
          onClick: () => {
            if (set.has(opt.id)) set.delete(opt.id);
            else set.add(opt.id);
            onChange([...set]);
            redraw();
          },
        }, opt.label));
      };
      for (const opt of selectedOpts) appendOption(opt);
      for (const id of visibleCustom) {
        box.append(el("button", {
          class: "chip on",
          type: "button",
          onClick: () => {
            set.delete(id);
            onChange([...set]);
            redraw();
          },
        }, id));
      }
      for (const opt of unselectedOpts) appendOption(opt);
      hint.textContent = pickListHint(query, visible.length + visibleCustom.length);
    };
    const addCustom = () => {
      const resolved = resolveListPick(options, custom.value, optionSearchKeys);
      if (!resolved || resolved.kind === "ambiguous") {
        redraw();
        return;
      }
      if (resolved.kind === "preset") {
        set.add(resolved.item.id);
      } else if (!set.has(resolved.value)) {
        set.add(resolved.value);
        trackCustomListItem(listKey, resolved.value);
      }
      onChange([...set]);
      custom.value = "";
      redraw();
    };
    const custom = el("input", {
      placeholder,
      maxlength: "40",
      autocomplete: "off",
      "aria-label": placeholder,
      onInput: () => redraw(),
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addCustom();
        }
      },
    });
    redraw();
    wrap.append(
      hint,
      el("div", { class: "row pick-list-tools" },
        custom,
        el("button", {
          class: "btn secondary",
          type: "button",
          onClick: addCustom,
        }, "Add")
      ),
      box
    );
    return wrap;
  }

  tagEditor(title, key, warn = false) {
    const p = getState().profile;
    const presets = this.tags[key] || this.tags.interests;
    const selected = new Set(p[key] || []);
    const chips = el("div", { class: "chips pick-list", dataset: { tags: key } });
    const hint = el("p", { class: "hint pick-list-hint", "aria-live": "polite" });
    const draw = () => {
      const query = custom.value;
      const visible = matchingTags(presets, query);
      const customSelected = [...selected].filter((tag) => !presets.includes(tag));
      const visibleCustom = matchingTags(customSelected, query);
      const selectedPresets = visible.filter((tag) => selected.has(tag));
      const unselectedPresets = visible.filter((tag) => !selected.has(tag));
      clear(chips);
      const appendTag = (tag) => {
        const on = selected.has(tag);
        chips.append(el("button", {
          class: `chip ${warn ? "warn" : ""} ${on ? "on" : ""}`,
          type: "button",
          onClick: () => {
            if (selected.has(tag)) selected.delete(tag);
            else selected.add(tag);
            updateProfile({ [key]: [...selected] });
            draw();
          },
        }, tag));
      };
      for (const tag of selectedPresets) appendTag(tag);
      for (const tag of visibleCustom) {
        chips.append(el("button", {
          class: `chip ${warn ? "warn" : ""} on`,
          type: "button",
          onClick: () => {
            selected.delete(tag);
            updateProfile({ [key]: [...selected] });
            draw();
          },
        }, tag));
      }
      for (const tag of unselectedPresets) appendTag(tag);
      hint.textContent = pickListHint(query, visible.length + visibleCustom.length);
    };
    const addCustom = () => {
      const resolved = resolveListPick(presets, custom.value, (tag) => [tag]);
      if (!resolved || resolved.kind === "ambiguous") {
        draw();
        return;
      }
      const value = resolved.kind === "preset" ? resolved.item : resolved.value;
      if (!selected.has(value)) {
        selected.add(value);
        if (resolved.kind === "custom") trackCustomListItem(key, value);
        updateProfile({ [key]: [...selected] });
      }
      custom.value = "";
      draw();
    };
    const custom = el("input", {
      placeholder: "Search or add your own",
      maxlength: "40",
      autocomplete: "off",
      "aria-label": `Search or add ${title}`,
      onInput: () => draw(),
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addCustom();
        }
      },
    });
    draw();
    return this.profileSection(
      key,
      title,
      hint,
      el("div", { class: "row pick-list-tools" },
        custom,
        el("button", {
          class: "btn secondary",
          type: "button",
          onClick: addCustom,
        }, "Add")
      ),
      chips,
      { privacyField: key }
    );
  }

  renderQuestionnaire() {
    const p = getState().profile;
    const answers = { ...(p.questionnaire || {}) };
    const fields = this.questions.map((q) => this.field(q.prompt, el("select", {
      onChange: (e) => {
        answers[q.id] = e.target.value;
        updateProfile({ questionnaire: { ...answers } });
      },
    },
      el("option", { value: "" }, "Choose…"),
      ...q.options.map((o) => el("option", {
        value: o.id,
        selected: answers[q.id] === o.id,
      }, o.label))
    ), { field: "questionnaire", item: q.id }));
    return this.profileSection("values", "Values and how you show up", ...fields);
  }

  renderStack() {
    this.refreshRanked();
    const zip = getState().profile.zip;
    const distance = getState().filters.distance;
    const item = this.ranked[this.stackIndex];
    const pills = el("div", { class: "zone-pills" },
      zip ? el("span", {}, `ZIP ${zip}`) : null,
      el("span", {}, distance === "all" ? "Any nearby" : `Within ${distanceOptionLabel(distance)}`),
      this.rooms.length ? el("span", {}, `${this.rooms.length} ZIP ${this.rooms.length === 1 ? "room" : "rooms"}`) : null
    );

    if (!item) {
      return el("section", { class: "stack-col" },
        pills,
        el("section", { class: "panel empty" },
          el("h2", {}, "Nobody else is here yet"),
          el("p", { class: "lede" }, "Discovery is online-only. Keep this tab open so someone nearby can find you. Try a larger distance if nearby ZIP rooms are quiet.")
        )
      );
    }

    const person = item.person;
    const pending = this.pairNet?.isPending(person.peerId);
    const interested = isInterested(person.peerId);
    const pair = getPair(person.peerId);
    const friend = isFriend(person.peerId) || Boolean(pair?.friend);
    const matched = Boolean(pair?.matched);
    const incomingInterest = themInterestedUnmatched(person.peerId);
    const handle = pair?.handle || person.handle || "";
    if (this.trackedPeer !== person.peerId) {
      this.trackedPeer = person.peerId;
      track("stack_view");
    }
    const scroll = el("div", { class: "stack-scroll" },
      pills,
      this.personCard({ ...person, handle }, item.miles, {
        hideHandle: !handle,
        incomingInterest,
      })
    );
    const connectLabel = pending
      ? "Saving…"
      : interested
        ? "Remove connection"
        : incomingInterest
          ? "Connect"
          : "Ask to connect";
    const actions = el("div", { class: "stack-col stack-actions" });
    const canFriend = interested && matched;
    if (!friend) {
      actions.append(el("button", {
        class: `btn ${interested ? "danger" : ""}`,
        type: "button",
        disabled: pending,
        onClick: () => {
          const next = !isInterested(person.peerId);
          this.pairNet?.proposeInterest(person.peerId, next);
          this.render();
        },
      }, connectLabel));
    }
    if (friend || canFriend) {
      actions.append(this.friendToggleButton(person.peerId, { ...person, handle }));
    }
    scroll.append(actions);
    return el("section", { class: "stack-col stack-view" },
      scroll,
      el("div", { class: "pager" },
        el("button", {
          class: "btn secondary",
          type: "button",
          disabled: this.stackIndex <= 0,
          onClick: () => {
            this.stackIndex -= 1;
            this.render();
          },
        }, "Back"),
        el("span", { class: "hint" }, `${this.stackIndex + 1} / ${this.ranked.length}`),
        el("button", {
          class: "btn secondary",
          type: "button",
          disabled: this.stackIndex >= this.ranked.length - 1,
          onClick: () => {
            this.stackIndex += 1;
            this.render();
          },
        }, "Next")
      )
    );
  }

  toggleFriend(peerId, person, currentlyFriend) {
    const handle = person?.handle || getPair(peerId)?.handle || "";
    const name = handle || "this person";
    if (currentlyFriend) {
      if (!confirm(`Remove ${name} as a friend? This removes you from each other's friends lists.`)) return;
      if (this.pairNet) this.pairNet.proposeFriend(peerId, false);
      else removeFriend(peerId);
      track("remove_friend");
      if (this.friendPeerId === peerId) this.friendPeerId = null;
      if (this.chatPeerId === peerId) this.chatPeerId = null;
    } else {
      if (this.pairNet) this.pairNet.proposeFriend(peerId, true, { ...person, peerId, handle });
      else addFriend({ ...person, peerId, handle });
      track("add_friend");
      if (this.personPeerId === peerId) {
        this.friendPeerId = peerId;
        this.personPeerId = null;
        this.view = "friends";
      }
    }
    this.render();
    this.refreshMatchOverlay(peerId);
  }

  friendToggleButton(peerId, person) {
    const friend = isFriend(peerId) || Boolean(getPair(peerId)?.friend);
    return el("button", {
      class: friend ? "btn danger" : "btn secondary",
      type: "button",
      onClick: () => this.toggleFriend(peerId, person, friend),
    }, friend ? "Remove friend" : "Add as friend");
  }

  personCard(person, miles, { hideHandle, full, incomingInterest } = {}) {
    const pair = getPair(person.peerId);
    const title = hideHandle ? "Someone nearby" : (person.handle || pair?.handle || "Someone nearby");
    const milesLabel = formatMilesLabel(miles);
    const zip = String(person.zip || person.zones?.zip || "").trim();
    const loc = publishedLoc(person.loc);
    const dating = hasRelationshipIntent(person);
    const answered = dating ? this.questions.filter((q) => person.questionnaire?.[q.id]) : [];
    const questions = full ? answered : answered.slice(0, 4);
    const looking = lookingForChips(person, { compact: !full });
    const order = sanitizeSectionOrder(person.sectionOrder);
    const interestTags = (person.interests || []).slice(0, full ? 24 : 8);
    const locationLinks = [];
    if (zip) locationLinks.push(mapsLink(zip, `ZIP ${zip}`));
    if (loc) {
      const coords = formatLatLng(loc);
      locationLinks.push(mapsLink(`${loc.lat},${loc.lng}`, `Geo ${coords}`, `Open ${coords} in Google Maps`));
    }
    const blocks = {
      about: full && locationLinks.length
        ? el("p", { class: "hint person-location" }, ...locationLinks)
        : null,
      looking: looking.length ? el("div", { class: "chips intent-chips" },
        ...looking.map((chip) => el("span", { class: `chip intent ${chip.id}` }, chip.label))
      ) : null,
      interests: interestTags.length ? el("div", { class: "chips" },
        ...interestTags.map((t) => el("span", { class: "chip on" }, t))
      ) : null,
      hobbies: full && (person.hobbies || []).length ? el("div", { class: "chips" },
        ...(person.hobbies || []).map((t) => el("span", { class: "chip on" }, t))
      ) : null,
      antiInterests: full && (person.antiInterests || []).length ? el("div", { class: "chips" },
        ...(person.antiInterests || []).map((t) => el("span", { class: "chip warn on" }, t))
      ) : null,
      values: questions.length ? el("div", { class: "q-list" },
        ...questions.map((q) => el("div", {},
          el("span", {}, q.prompt),
          el("span", {}, optionLabel(this.questions, q.id, person.questionnaire?.[q.id]))
        ))
      ) : null,
      youtube: this.youtubeVideoViewer(person.youtubeVideoIds, {
        title: `${title}'s YouTube`,
        startOpen: Boolean(full),
      }),
      "youtube-music": this.youtubePlaylistViewer(person.youtubePlaylistId, person.youtubePlaylistThumb, {
        title: `${title}'s YouTube Music`,
        startOpen: Boolean(full),
      }),
      linkedin: this.linkedinViewer(person.linkedin),
      github: this.githubViewer(person.github),
      soundcloud: this.soundcloudViewer(person.soundcloud),
      bandcamp: this.bandcampViewer(person.bandcamp),
    };
    const extra = [];
    for (const id of order) {
      const node = blocks[id];
      if (node) extra.push(node);
    }
    return el("article", { class: "card person-card" },
      person.photo ? el("img", { class: "photo", src: person.photo, alt: title }) : el("div", { class: "photo" }),
      el("div", { class: "person-body" },
        incomingInterest ? el("p", { class: "interested-banner" }, "They asked to connect!") : null,
        el("h2", {}, `${title}${person.age ? `, ${person.age}` : ""}`),
        el("div", { class: "meta" },
          el("span", {}, genderLabel(person)),
          el("span", {}, milesLabel)
        ),
        extra.length ? el("div", { class: "person-sections" }, ...extra) : null
      )
    );
  }

  renderFilterSheet() {
    const f = getState().filters;
    const sheet = el("div", { class: "overlay", id: "filter-sheet", onClick: (e) => {
      if (e.target === sheet) {
        this.filterOpen = false;
        this.render();
      }
    } },
      el("div", { class: "sheet stack-col" },
        el("h2", {}, "Filters and ranking"),
        el("div", { class: "field" },
          el("label", {}, "People"),
          el("select", {
            onChange: (e) => {
              this.patchFilters({ peopleFilter: e.target.value });
              this.stackIndex = 0;
            },
          },
            ...PEOPLE_FILTER_OPTIONS.map((o) => el("option", {
              value: o.id,
              selected: (f.peopleFilter || "all") === o.id,
            }, o.label))
          )
        ),
        el("div", { class: "field" },
          el("label", {}, "Looking for"),
          this.chipGroup(LOOKING_FOR_OPTIONS, f.intents, (intents) => {
            this.patchFilters({ intents });
            this.render();
          }),
          el("p", { class: "hint" }, "Leave empty to see every compatible person.")
        ),
        el("div", { class: "range-row" },
          this.field("Min age", el("input", {
            type: "number", min: MIN_AGE, max: MAX_AGE, value: f.minAge,
            onChange: (e) => this.patchFilters({ minAge: Number(e.target.value) || MIN_AGE }),
          })),
          this.field("Max age", el("input", {
            type: "number", min: MIN_AGE, max: MAX_AGE, value: f.maxAge,
            onChange: (e) => this.patchFilters({ maxAge: Number(e.target.value) || MAX_AGE }),
          }))
        ),
        this.distanceField(),
        this.field(`Interest weight (${f.interestWeight})`, el("input", {
          type: "range", min: "0", max: "1", step: "0.05", value: f.interestWeight,
          onInput: (e) => this.patchFilters({ interestWeight: Number(e.target.value) }),
        })),
        el("button", {
          class: "btn",
          type: "button",
          onClick: () => {
            this.filterOpen = false;
            this.stackIndex = 0;
            this.render();
          },
        }, "Done")
      )
    );
    return sheet;
  }

  distanceField({ hint = true } = {}) {
    const f = getState().filters;
    const precise = isPreciseGeolocation();
    const options = availableDistanceOptions(precise);
    const distance = clampDistanceOption(f.distance, precise);
    return el("div", { class: "field distance-field" },
      el("label", {}, `Distance (${distanceOptionLabel(distance)})`),
      el("input", {
        type: "range",
        min: "0",
        max: String(Math.max(0, options.length - 1)),
        step: "1",
        value: String(distanceOptionIndex(distance, options)),
        "aria-label": "Distance",
        "aria-valuetext": distanceOptionLabel(distance),
        onInput: (e) => {
          const v = options[Number(e.target.value)] ?? DEFAULT_DISTANCE_MILES;
          this.patchFilters({ distance: v });
          const label = e.target.closest(".field")?.querySelector("label");
          if (label) label.textContent = `Distance (${distanceOptionLabel(v)})`;
          e.target.setAttribute("aria-valuetext", distanceOptionLabel(v));
          this.syncLocationStatus();
        },
        onChange: (e) => {
          const v = options[Number(e.target.value)] ?? DEFAULT_DISTANCE_MILES;
          this.refreshDiscoveryRooms().then(() => this.syncLocationStatus());
          track("filter_change", { distance: String(v) });
        },
      }),
      hint ? el("p", { class: "hint" }, precise
        ? "Nearby ZIP rooms are rebuilt from this radius. Precise location is on, so distances under 2 miles use the GPS coordinates you share with the Geo location lock on You."
        : "Nearby ZIP rooms are rebuilt from this radius. ZIP is shared without coordinates. Distances under 2 miles need Precise location in Settings.") : null
    );
  }

  locationStatusText() {
    const zip = getState().profile.zip;
    const distance = getState().filters.distance;
    const distanceLabel = distance === "all" ? "any nearby ZIP" : distanceOptionLabel(distance);
    if (this.locating) return "Refreshing location…";
    if (!zip) return "Location unknown";
    return `ZIP ${zip} · ${this.rooms.length} ZIP ${this.rooms.length === 1 ? "room" : "rooms"} · ${distanceLabel}`;
  }

  syncLocationStatus() {
    if (this.locationStatusEl?.isConnected) this.locationStatusEl.textContent = this.locationStatusText();
  }

  patchFilters(patch) {
    const precise = isPreciseGeolocation();
    const next = { ...getState().filters, ...patch };
    next.distance = clampDistanceOption(next.distance, precise);
    updateStore({ filters: next });
  }

  livePerson(peerId) {
    return this.people.find((p) => p.peerId === peerId) || null;
  }

  renderFriends() {
    if (this.friendPeerId) {
      const saved = getFriend(this.friendPeerId);
      if (saved) return this.renderFriendProfile(saved);
      this.friendPeerId = null;
    }
    const friends = getState().friends;
    const offline = isOffline();
    const wrap = el("section", { class: "stack-col" },
      el("h1", {}, "Friends"),
      el("p", { class: "lede" }, offline
        ? "You are offline. Nearby people cannot see you, and you can only message friends."
        : "Open a saved profile anytime. You still have it after they go offline. Use Chat on a friend to message them. Either of you can remove the friendship."),
      offline ? el("div", { class: "stack-col stack-actions" },
        el("button", {
          class: "btn",
          type: "button",
          onClick: () => this.goOnline(),
        }, "Go online")
      ) : null,
    );
    if (!friends.length) {
      wrap.append(el("section", { class: "panel empty" }, el("p", {}, "No friends saved yet.")));
      return wrap;
    }
    for (const f of friends) {
      const online = this.personIsOnline(f.peerId);
      const name = f.handle || "Friend";
      wrap.append(el("article", { class: "card friend-card" },
        el("div", { class: "friend-row" },
          el("button", {
            class: "friend-open",
            type: "button",
            onClick: () => {
              const live = this.livePerson(f.peerId);
              if (live) updateFriend(mergeFriendProfile(f, live));
              this.friendPeerId = f.peerId;
              this.render();
            },
          },
            f.photo ? el("img", { src: f.photo, alt: "" }) : el("div", { class: "friend-photo-fallback", "aria-hidden": "true" }),
            el("div", { class: "friend-copy" },
              el("strong", { class: "friend-name" }, name),
              el("span", { class: "hint" }, `${f.age ? `${f.age} · ` : ""}${genderLabel(f)}`),
              el("span", { class: online ? "presence-pill online" : "presence-pill offline" }, online ? "Online" : "Offline")
            )
          ),
          el("button", {
            class: "btn friend-chat-btn",
            type: "button",
            "aria-label": `Chat with ${name}`,
            onClick: () => this.openChat(f.peerId),
          }, "Chat")
        )
      ));
    }
    return wrap;
  }

  renderFriendProfile(saved) {
    const extra = this.pairNet?.profiles?.get(saved.peerId);
    const live = this.livePerson(saved.peerId);
    const person = mergeFriendProfile(saved, live || extra);
    const me = getState().profile;
    const miles = distanceMiles(me, person);
    const name = person.handle || saved.handle || "Friend";
    const online = this.personIsOnline(saved.peerId);
    this.askProfile(saved.peerId);
    return el("section", { class: "stack-col" },
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.friendPeerId = null;
          this.render();
        },
      }, "Back"),
      el("p", { class: online ? "presence-pill online" : "presence-pill offline" },
        online ? "Online now" : "Offline — showing the profile saved on this device"
      ),
      this.personCard({ ...person, handle: name }, miles, { hideHandle: false, full: true }),
      el("button", {
        class: "btn",
        type: "button",
        onClick: () => this.openChat(saved.peerId),
      }, "Open chat"),
      el("button", {
        class: "btn danger",
        type: "button",
        onClick: () => this.toggleFriend(saved.peerId, { ...person, handle: name }, true),
      }, "Remove friend")
    );
  }

  openChat(peerId) {
    if (!peerId) return;
    this.chatPeerId = peerId;
    this.chatGroupId = null;
    this.chatCreating = false;
    this.groupInviteOpen = false;
    this.view = "chat";
    this.friendPeerId = null;
    this.personPeerId = null;
    this.acknowledgeChat(peerId);
    this.render();
  }

  openGroup(groupId) {
    if (!groupId || !getGroup(groupId) || getGroup(groupId).left) return;
    this.chatGroupId = groupId;
    this.chatPeerId = null;
    this.chatCreating = false;
    this.groupInviteOpen = false;
    this.view = "chat";
    this.friendPeerId = null;
    this.personPeerId = null;
    this.acknowledgeGroup(groupId);
    this.pairNet?.retainPeers(this.watchPeerIds());
    this.render();
  }

  acknowledgeChat(peerId) {
    if (!peerId) return;
    markChatRead(peerId);
    this.pairNet?.sendChatRead(peerId);
  }

  acknowledgeGroup(groupId) {
    if (!groupId) return;
    markGroupRead(groupId);
    this.pairNet?.sendGroupRead(groupId);
  }

  async clearGroupThread(groupId) {
    const group = getGroup(groupId);
    if (!canClearGroup(group, getState().peerId)) return;
    if (!confirm("Clear this group chat for everyone? If they are offline, their copy is removed the next time they connect.")) return;
    if (this.pairNet) await this.pairNet.clearGroupChat(groupId);
    else clearGroupChat(groupId);
    this.render();
  }

  memberName(peerId) {
    if (!peerId) return "Someone";
    if (peerId === getState().peerId) return "You";
    return getFriend(peerId)?.handle
      || this.pairNet?.profiles?.get(peerId)?.handle
      || this.livePerson(peerId)?.handle
      || "Member";
  }

  memberPhoto(peerId) {
    if (!peerId) return "";
    if (peerId === getState().peerId) return getState().profile?.photo || "";
    return getFriend(peerId)?.photo
      || this.pairNet?.profiles?.get(peerId)?.photo
      || this.livePerson(peerId)?.photo
      || "";
  }

  memberInitial(peerId) {
    const name = this.memberName(peerId);
    return ([...name][0] || "?").toUpperCase();
  }

  memberAvatar(peerId, { className = "chat-avatar", alt = "", title = "" } = {}) {
    const name = this.memberName(peerId);
    const label = alt || name;
    const photo = this.memberPhoto(peerId);
    if (photo) {
      return el("img", {
        class: className,
        src: photo,
        alt: label,
        title: title || name,
      });
    }
    return el("div", {
      class: `${className} fallback`,
      title: title || name,
      "aria-label": label,
    }, this.memberInitial(peerId));
  }

  groupOnlineCount(group) {
    const me = getState().peerId;
    let n = 1;
    for (const m of group?.members || []) {
      if (m.peerId === me) continue;
      if (this.personIsOnline(m.peerId)) n += 1;
    }
    return n;
  }

  stopChatPrune() {
    if (this.chatPruneTimer) {
      clearInterval(this.chatPruneTimer);
      this.chatPruneTimer = null;
    }
  }

  startChatPrune(peerId) {
    this.stopChatPrune();
    if (!chatRetentionMs(getChatRetention(peerId))) return;
    this.chatPruneTimer = setInterval(() => {
      if (this.view !== "chat" || this.chatPeerId !== peerId) {
        this.stopChatPrune();
        return;
      }
      const roomId = this.chatRooms.get(peerId);
      if (!roomId) return;
      const next = pruneChat(roomId);
      const ids = new Set(next.map((m) => m.id));
      if (ids.size !== this.chatSeenIds.size || [...this.chatSeenIds].some((id) => !ids.has(id))) {
        this.render();
      }
    }, 30_000);
  }

  startGroupPrune(groupId) {
    this.stopChatPrune();
    if (!chatRetentionMs(getGroupRetention(groupId))) return;
    this.chatPruneTimer = setInterval(() => {
      if (this.view !== "chat" || this.chatGroupId !== groupId) {
        this.stopChatPrune();
        return;
      }
      const next = pruneChat(groupId);
      const ids = new Set(next.map((m) => m.id));
      if (ids.size !== this.chatSeenIds.size || [...this.chatSeenIds].some((id) => !ids.has(id))) {
        this.render();
      }
    }, 30_000);
  }

  renderChat() {
    if (this.chatCreating) return this.renderGroupCreate();
    if (this.chatGroupId) {
      const group = getGroup(this.chatGroupId);
      if (group && !group.left) return this.renderGroupThread(this.chatGroupId, group);
      this.chatGroupId = null;
    }
    if (this.chatPeerId) {
      const saved = getFriend(this.chatPeerId);
      if (saved) return this.renderChatThread(saved);
      this.chatPeerId = null;
    }
    return this.renderChatList();
  }

  lastChat(peerId) {
    const roomId = this.chatRooms.get(peerId) || getChatRoom(peerId);
    if (!roomId) return null;
    if (!this.chatRooms.has(peerId)) this.chatRooms.set(peerId, roomId);
    const messages = getChat(roomId);
    return messages[messages.length - 1] || null;
  }

  lastGroupChat(groupId) {
    const messages = getChat(groupId);
    return messages[messages.length - 1] || null;
  }

  renderChatList() {
    const friends = getState().friends;
    const groups = listGroups();
    const invites = getGroupInvites();
    const offline = isOffline();
    const wrap = el("section", { class: "stack-col" },
      el("h1", {}, "Chat"),
      el("p", { class: "lede" }, offline
        ? "You are offline. Saved chats and groups still get messages if they have the app open."
        : "Open a saved chat, or start a live group. New 1:1 chats start from Friends. Group messages are not stored for people who were away.")
    );
    wrap.append(el("button", {
      class: "btn",
      type: "button",
      onClick: () => {
        this.chatCreating = true;
        this.chatPeerId = null;
        this.chatGroupId = null;
        this.render();
      },
    }, "New group"));
    for (const row of invites) {
      const invite = row.invite;
      const name = invite.genesis?.name || "Group";
      wrap.append(el("section", { class: "panel group-invite-card" },
        el("p", {}, `${this.memberName(invite.from)} invited you to ${name}`),
        el("p", { class: "hint" }, invite.genesis?.invitePolicy === "members"
          ? "Public — members can invite their friends. Not listed on Online."
          : "Private — only the creator can invite. Not listed on Online."),
        el("div", { class: "row" },
          el("button", {
            class: "btn",
            type: "button",
            onClick: async () => {
              const id = await this.pairNet?.acceptGroupInvite(invite);
              if (id) this.openGroup(id);
              else this.render();
            },
          }, "Accept"),
          el("button", {
            class: "btn secondary",
            type: "button",
            onClick: async () => {
              await this.pairNet?.declineGroupInvite(invite);
              this.render();
            },
          }, "Decline")
        )
      ));
    }
    const groupCards = groups.map((g) => ({
      kind: "group",
      id: g.groupId,
      at: this.lastGroupChat(g.groupId)?.at || g.createdAt || 0,
      name: g.name || "Group",
      group: g,
    }));
    const friendCards = friends.flatMap((f) => {
      const last = this.lastChat(f.peerId);
      if (!last) return [];
      return [{
        kind: "friend",
        id: f.peerId,
        at: last.at || 0,
        name: f.handle || "Friend",
        friend: f,
      }];
    });
    const ranked = [...groupCards, ...friendCards].sort((a, b) => {
      if (b.at !== a.at) return b.at - a.at;
      return String(a.name).localeCompare(String(b.name));
    });
    if (!ranked.length && !invites.length) {
      wrap.append(el("section", { class: "panel empty" },
        el("p", {}, friends.length
          ? "No saved chats. Start one from Friends."
          : "No friends yet. Add someone from Online or a QR code")
      ));
      return wrap;
    }
    for (const item of ranked) {
      if (item.kind === "group") {
        const last = this.lastGroupChat(item.id);
        const preview = last
          ? `${this.memberName(last.from)}: ${previewChatText(last.text)}`
          : "Live group — they need the app open";
        const unread = unreadGroupCount(item.id);
        const online = this.groupOnlineCount(item.group);
        const total = (item.group.members || []).length;
        wrap.append(el("article", {
          class: unread ? "card friend-card has-unread" : "card friend-card",
        },
          el("div", { class: "friend-row" },
            el("button", {
              class: "friend-open",
              type: "button",
              onClick: () => this.openGroup(item.id),
            },
              el("div", { class: "group-photo-fallback", "aria-hidden": "true" }, "G"),
              el("div", { class: "friend-copy" },
                el("strong", { class: "friend-name" }, item.name),
                el("span", { class: "hint chat-preview" }, preview),
                el("span", { class: online > 1 ? "presence-pill online" : "presence-pill offline" },
                  `${online} of ${total} here now`)
              ),
              unread ? el("span", { class: "unread-badge", "aria-label": `${unread} unread` }, unreadLabel(unread)) : null
            ),
            canClearGroup(item.group, getState().peerId) ? el("button", {
              class: "btn danger friend-clear-btn",
              type: "button",
              "aria-label": `Clear ${item.name}`,
              onClick: () => this.clearGroupThread(item.id),
            }, "Clear") : null
          )
        ));
        continue;
      }
      const f = item.friend;
      const online = this.personIsOnline(f.peerId);
      const last = this.lastChat(f.peerId);
      const preview = last ? previewChatText(last.text) : "";
      const unread = unreadChatCount(f.peerId);
      wrap.append(el("article", {
        class: unread ? "card friend-card has-unread" : "card friend-card",
      },
        el("div", { class: "friend-row" },
          el("button", {
            class: "friend-open",
            type: "button",
            onClick: () => this.openChat(f.peerId),
          },
            f.photo ? el("img", { src: f.photo, alt: "" }) : el("div", { class: "friend-photo-fallback", "aria-hidden": "true" }),
            el("div", { class: "friend-copy" },
              el("strong", { class: "friend-name" }, item.name),
              el("span", { class: "hint chat-preview" }, preview),
              el("span", { class: online ? "presence-pill online" : "presence-pill offline" }, online ? "Online" : "Offline")
            ),
            unread ? el("span", { class: "unread-badge", "aria-label": `${unread} unread` }, unreadLabel(unread)) : null
          ),
          el("button", {
            class: "btn danger friend-clear-btn",
            type: "button",
            "aria-label": `Clear chat with ${item.name}`,
            onClick: async () => {
              if (!confirm("Clear this chat on both devices? If they are offline, their copy is removed the next time they connect.")) return;
              if (this.pairNet) await this.pairNet.clearChat(f.peerId);
              else clearChat(f.peerId, { roomId: this.chatRooms.get(f.peerId) });
              this.render();
            },
          }, "Clear")
        )
      ));
    }
    return wrap;
  }

  renderGroupCreate() {
    const friends = getState().friends;
    const selected = new Set(this.groupCreateSelected || []);
    const policy = this.groupCreatePolicy || "creator";
    const policyOpt = GROUP_INVITE_POLICIES.find((o) => o.id === policy) || GROUP_INVITE_POLICIES[0];
    const wrap = el("section", { class: "stack-col" },
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.chatCreating = false;
          this.render();
        },
      }, "Back"),
      el("h1", {}, "New group"),
      el("p", { class: "lede" }, "Live only. Friends who are not here miss messages. Groups are never listed on Online.")
    );
    const nameInput = el("input", {
      type: "text",
      maxlength: "40",
      placeholder: "Group name",
      value: this.groupCreateName || "",
      "aria-label": "Group name",
      onInput: (e) => { this.groupCreateName = e.target.value; },
    });
    wrap.append(this.field("Name", nameInput));
    wrap.append(this.field("Who can invite", this.select(
      GROUP_INVITE_POLICIES,
      policy,
      (value) => {
        this.groupCreatePolicy = value;
        this.render();
      },
      { blank: false }
    )));
    wrap.append(el("p", { class: "hint" }, policyOpt.hint));
    if (!friends.length) {
      wrap.append(el("p", { class: "hint" }, "Add friends first, then you can invite them."));
    } else {
      wrap.append(el("p", { class: "hint" }, `Invite friends now (max ${GROUP_MEMBER_MAX - 1} besides you). They get the invite when they are online.`));
      const chips = el("div", { class: "chips" });
      for (const f of friends) {
        const on = selected.has(f.peerId);
        chips.append(el("button", {
          class: on ? "chip on" : "chip",
          type: "button",
          onClick: () => {
            const next = new Set(this.groupCreateSelected || []);
            if (next.has(f.peerId)) next.delete(f.peerId);
            else if (next.size < GROUP_MEMBER_MAX - 1) next.add(f.peerId);
            this.groupCreateSelected = next;
            this.render();
          },
        }, f.handle || "Friend"));
      }
      wrap.append(chips);
    }
    wrap.append(el("button", {
      class: "btn",
      type: "button",
      onClick: async () => {
        const name = String(this.groupCreateName || "").trim();
        if (!name) return;
        const id = await this.pairNet?.createGroup({
          name,
          invitePolicy: this.groupCreatePolicy || "creator",
          peerIds: [...(this.groupCreateSelected || [])],
        });
        this.groupCreateName = "";
        this.groupCreateSelected = new Set();
        this.chatCreating = false;
        if (id) this.openGroup(id);
        else this.render();
      },
    }, "Create group"));
    return wrap;
  }

  renderGroupThread(groupId, group) {
    const me = getState().peerId;
    const members = group.members || [];
    const online = this.groupOnlineCount(group);
    const canAdd = canInvite(group, me);
    const canClear = canClearGroup(group, me);
    const canRetain = canSetGroupRetention(group, me);
    this.startGroupPrune(groupId);
    this.composePeerId = groupId;
    this.acknowledgeGroup(groupId);
    for (const m of members) {
      if (m.peerId !== me) this.askProfile(m.peerId);
    }
    const wrap = el("section", { class: "stack-col chat-thread" },
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.chatGroupId = null;
          this.groupInviteOpen = false;
          this.render();
        },
      }, "Back"),
      el("div", { class: "chat-head" },
        el("div", { class: "group-photo-fallback", "aria-hidden": "true" }, "G"),
        el("div", { class: "friend-copy" },
          el("strong", { class: "friend-name" }, group.name || "Group"),
          el("span", { class: online > 1 ? "presence-pill online" : "presence-pill offline" },
            `${online} of ${members.length} here now — they need the app open to get new messages`
          )
        )
      ),
      el("div", { class: "group-members" },
        ...members.map((m) => {
          const here = m.peerId === me || this.personIsOnline(m.peerId);
          return el("span", {
            class: here ? "group-member on" : "group-member",
          }, this.memberName(m.peerId));
        }),
        ...(group.pendingInvites || []).map((id) => el("span", {
          class: "group-member pending",
        }, `${this.memberName(id)} (invited)`))
      ),
      (canRetain || canClear) ? el("div", { class: "chat-tools" },
        canRetain ? this.field("Keep messages", this.select(
          CHAT_RETENTION_OPTIONS,
          getGroupRetention(groupId),
          (value) => {
            if (this.pairNet) this.pairNet.setGroupRetention(groupId, value);
            else setGroupRetention(groupId, value);
            this.render();
          },
          { blank: false }
        )) : null,
        canClear ? el("button", {
          class: "btn danger",
          type: "button",
          onClick: () => this.clearGroupThread(groupId),
        }, "Clear") : null
      ) : null,
      el("div", { class: "row" },
        canAdd ? el("button", {
          class: "btn secondary",
          type: "button",
          onClick: () => {
            this.groupInviteOpen = !this.groupInviteOpen;
            this.render();
          },
        }, this.groupInviteOpen ? "Done" : "Invite") : null,
        el("button", {
          class: "btn danger",
          type: "button",
          onClick: async () => {
            if (!confirm("Leave this group? You will not get new messages.")) return;
            await this.pairNet?.leaveGroup(groupId);
            this.chatGroupId = null;
            this.render();
          },
        }, "Leave")
      )
    );
    if (this.groupInviteOpen && canAdd) {
      const inGroup = new Set(members.map((m) => m.peerId));
      for (const id of group.pendingInvites || []) inGroup.add(id);
      const candidates = getState().friends.filter((f) => !inGroup.has(f.peerId));
      if (!candidates.length) {
        wrap.append(el("p", { class: "hint" }, "Every friend is already in this group or invited."));
      } else {
        wrap.append(el("p", { class: "hint" }, "Invite a friend who is online now, or they will get it the next time they connect."));
        const chips = el("div", { class: "chips" });
        for (const f of candidates) {
          chips.append(el("button", {
            class: "chip",
            type: "button",
            onClick: async () => {
              await this.pairNet?.inviteToGroup(groupId, f.peerId);
              this.render();
            },
          }, f.handle || "Friend"));
        }
        wrap.append(chips);
      }
    }
    const messages = getChat(groupId);
    this.chatSeenIds = new Set(messages.map((m) => m.id));
    const log = el("div", { class: "chat-log", "aria-live": "polite" });
    this.chatLogEl = log;
    this.readEl = null;
    this.typingEl = null;
    for (const m of messages) log.append(this.chatBubble(m, { group: true }));
    const input = el("input", {
      type: "text",
      maxlength: String(CHAT_TEXT_MAX),
      placeholder: "Message",
      "aria-label": "Message",
      value: this.composeDrafts.get(groupId) || "",
    });
    this.composeInput = input;
    const send = () => {
      const text = input.value;
      input.value = "";
      this.composeDrafts.set(groupId, "");
      this.pairNet?.sendGroupChat(groupId, text);
      track("chat_send");
    };
    input.addEventListener("input", () => {
      this.composeDrafts.set(groupId, input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send();
      }
    });
    wrap.append(
      log,
      el("div", { class: "chat-compose" },
        input,
        el("button", { class: "btn", type: "button", onClick: send }, "Send")
      )
    );
    this.placeGroupReadReceipts(groupId);
    queueMicrotask(() => { log.scrollTop = log.scrollHeight; });
    return wrap;
  }

  renderChatThread(saved) {
    const extra = this.pairNet?.profiles?.get(saved.peerId);
    const live = this.livePerson(saved.peerId);
    const person = mergeFriendProfile(saved, live || extra) || saved;
    const name = person.handle || saved.handle || "Friend";
    const online = this.personIsOnline(saved.peerId);
    const peerId = saved.peerId;
    this.askProfile(peerId);
    this.startChatPrune(peerId);
    let roomId = this.chatRooms.get(peerId) || getChatRoom(peerId);
    if (roomId) this.chatRooms.set(peerId, roomId);
    this.composePeerId = peerId;
    this.acknowledgeChat(peerId);
    const wrap = el("section", { class: "stack-col chat-thread" },
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.chatPeerId = null;
          this.render();
        },
      }, "Back"),
      el("div", { class: "chat-head" },
        person.photo
          ? el("img", { src: person.photo, alt: "" })
          : el("div", { class: "friend-photo-fallback", "aria-hidden": "true" }),
        el("div", { class: "friend-copy" },
          el("strong", { class: "friend-name" }, name),
          el("span", { class: online ? "presence-pill online" : "presence-pill offline" },
            online ? "Online now" : "Offline — they need the app open to get new messages"
          )
        )
      ),
      el("div", { class: "chat-tools" },
        this.field("Keep messages", this.select(
          CHAT_RETENTION_OPTIONS,
          getChatRetention(peerId),
          (value) => {
            if (this.pairNet) this.pairNet.setChatRetention(peerId, value);
            else setChatRetention(peerId, value);
            this.render();
          },
          { blank: false }
        )),
        el("button", {
          class: "btn danger",
          type: "button",
          onClick: async () => {
            if (!confirm("Clear this chat on both devices? If they are offline, their copy is removed the next time they connect.")) return;
            if (this.pairNet) await this.pairNet.clearChat(peerId);
            else clearChat(peerId, { roomId: this.chatRooms.get(peerId) });
            this.render();
          },
        }, "Clear")
      )
    );
    if (!roomId) {
      wrap.append(el("p", { class: "hint" }, "Opening chat room…"));
      this.ensureChatRoom(peerId).then(() => {
        if (this.chatPeerId === peerId && this.view === "chat") this.render();
      });
      return wrap;
    }
    const messages = getChat(roomId);
    this.chatSeenIds = new Set(messages.map((m) => m.id));
    const log = el("div", { class: "chat-log", "aria-live": "polite" });
    this.chatLogEl = log;
    for (const m of messages) log.append(this.chatBubble(m));
    const read = el("div", {
      class: "chat-bubble mine chat-read-receipt",
      hidden: true,
      "aria-label": "Read",
    },
      el("span", { class: "chat-text" }, "read"),
      el("span", { class: "read-check", "aria-hidden": "true" }, "✓")
    );
    this.readEl = read;
    log.append(read);
    const typing = el("div", {
      class: "chat-typing",
      hidden: !this.pairNet?.isTyping(peerId),
      "aria-live": "polite",
      "aria-label": "They are typing",
    },
      el("span", { class: "typing-dot" }),
      el("span", { class: "typing-dot" }),
      el("span", { class: "typing-dot" })
    );
    this.typingEl = typing;
    log.append(typing);
    const input = el("input", {
      type: "text",
      maxlength: String(CHAT_TEXT_MAX),
      placeholder: "Message",
      "aria-label": "Message",
      value: this.composeDrafts.get(peerId) || "",
    });
    this.composeInput = input;
    const send = () => {
      const text = input.value;
      input.value = "";
      this.composeDrafts.set(peerId, "");
      this.pairNet?.setTyping(peerId, false);
      this.pairNet?.sendChat(peerId, text);
      if (!this.pairNet) return;
      track("chat_send");
    };
    input.addEventListener("input", () => {
      this.composeDrafts.set(peerId, input.value);
      this.pairNet?.setTyping(peerId, Boolean(input.value.trim()));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send();
      }
    });
    wrap.append(
      log,
      el("div", { class: "chat-compose" },
        input,
        el("button", { class: "btn", type: "button", onClick: send }, "Send")
      )
    );
    this.placeReadReceipt(peerId, messages);
    queueMicrotask(() => { log.scrollTop = log.scrollHeight; });
    return wrap;
  }

  chatBubble(m, { group = false } = {}) {
    const mine = m.from === getState().peerId;
    const kids = [];
    if (group && !mine) {
      kids.push(el("span", { class: "chat-from" }, this.memberName(m.from)));
    }
    kids.push(el("span", { class: "chat-text" }, m.text));
    if (mine && this.canUndoMessage(m, { group })) {
      kids.push(el("button", {
        class: "chat-undo",
        type: "button",
        "aria-label": "Undo send",
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.undoSentMessage(m, { group });
        },
      }, "Undo"));
    }
    const bubble = el("div", {
      class: `chat-bubble ${mine ? "mine" : "theirs"}`,
      dataset: { id: m.id, at: String(Number(m.at) || 0) },
    }, ...kids);
    if (!group) return bubble;
    const side = mine ? "mine" : "theirs";
    return el("div", {
      class: `chat-block ${side}`,
      dataset: { id: m.id, at: String(Number(m.at) || 0) },
    },
      el("div", { class: "chat-row" },
        this.memberAvatar(m.from),
        bubble
      ),
      el("div", {
        class: "chat-read-avatars",
        hidden: true,
      })
    );
  }

  placeReadReceipt(peerId, messages) {
    if (this.view !== "chat" || this.chatPeerId !== peerId) return false;
    if (!this.readEl || !this.chatLogEl) return false;
    const last = lastReadOutgoing(messages, {
      me: getState().peerId,
      themReadAt: getThemChatReadAt(peerId),
    });
    this.readEl.hidden = !last;
    const bubble = last ? this.chatLogEl.querySelector(`.chat-bubble[data-id="${CSS.escape(last.id)}"]`) : null;
    if (bubble) bubble.after(this.readEl);
    else if (this.typingEl) this.chatLogEl.insertBefore(this.readEl, this.typingEl);
    else this.chatLogEl.append(this.readEl);
    const after = this.readEl.nextElementSibling;
    const atEnd = !after || after === this.typingEl;
    if (!this.readEl.hidden && atEnd && this.chatLogEl.isConnected) {
      this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    }
    return true;
  }

  refreshReadReceipts(peerId) {
    if (this.view !== "chat" || this.chatPeerId !== peerId) return false;
    const roomId = this.chatRooms.get(peerId);
    const messages = roomId ? getChat(roomId) : [];
    const placed = this.placeReadReceipt(peerId, messages);
    this.refreshUndoButtons();
    return placed;
  }

  placeGroupReadReceipts(groupId) {
    if (this.view !== "chat" || this.chatGroupId !== groupId) return false;
    if (!this.chatLogEl) return false;
    const group = getGroup(groupId);
    const byMsg = lastReadMessageByPeer(getChat(groupId), {
      me: getState().peerId,
      members: (group?.members || []).map((m) => m.peerId),
      readAtByPeer: getGroupThemChatReadAt(groupId),
    });
    for (const block of this.chatLogEl.querySelectorAll(".chat-block")) {
      const strip = block.querySelector(".chat-read-avatars");
      if (!strip) continue;
      const ids = byMsg.get(block.dataset.id) || [];
      strip.replaceChildren();
      strip.hidden = !ids.length;
      if (!ids.length) {
        strip.removeAttribute("aria-label");
        continue;
      }
      const names = [];
      for (const peerId of ids) {
        const name = this.memberName(peerId);
        names.push(name);
        strip.append(this.memberAvatar(peerId, {
          className: "chat-read-avatar",
          alt: `Read by ${name}`,
          title: name,
        }));
      }
      strip.setAttribute("aria-label", `Read by ${names.join(", ")}`);
    }
    this.refreshUndoButtons({ group: true });
    return true;
  }

  refreshTypingIndicator(peerId) {
    if (this.view !== "chat" || this.chatPeerId !== peerId) return false;
    if (!this.typingEl?.isConnected) return false;
    const on = Boolean(this.pairNet?.isTyping(peerId));
    this.typingEl.hidden = !on;
    if (on && this.chatLogEl) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    return true;
  }

  refreshChatLog(peerId) {
    if (this.view !== "chat" || this.chatPeerId !== peerId) return false;
    if (!this.chatLogEl?.isConnected) return false;
    const roomId = this.chatRooms.get(peerId);
    if (!roomId) return false;
    const messages = getChat(roomId);
    const ids = new Set(messages.map((m) => m.id));
    for (const node of [...this.chatLogEl.querySelectorAll(":scope > .chat-bubble[data-id]")]) {
      if (ids.has(node.dataset.id)) continue;
      this.chatSeenIds.delete(node.dataset.id);
      node.remove();
    }
    for (const m of messages) {
      if (this.chatSeenIds.has(m.id)) continue;
      this.chatSeenIds.add(m.id);
      const bubble = this.chatBubble(m);
      if (this.typingEl?.isConnected) this.chatLogEl.insertBefore(bubble, this.typingEl);
      else this.chatLogEl.append(bubble);
    }
    this.refreshUndoButtons();
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    return true;
  }

  refreshGroupChatLog(groupId) {
    if (this.view !== "chat" || this.chatGroupId !== groupId) return false;
    if (!this.chatLogEl?.isConnected) return false;
    const messages = getChat(groupId);
    const ids = new Set(messages.map((m) => m.id));
    for (const node of [...this.chatLogEl.querySelectorAll(":scope > .chat-block[data-id]")]) {
      if (ids.has(node.dataset.id)) continue;
      this.chatSeenIds.delete(node.dataset.id);
      node.remove();
    }
    for (const m of messages) {
      if (this.chatSeenIds.has(m.id)) continue;
      this.chatSeenIds.add(m.id);
      this.chatLogEl.append(this.chatBubble(m, { group: true }));
    }
    this.refreshUndoButtons({ group: true });
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    return true;
  }

  canUndoMessage(message, { group = false } = {}) {
    const me = getState().peerId;
    if (group) {
      return canUndoOutgoingGroup(message, {
        me,
        readAtByPeer: getGroupThemChatReadAt(this.chatGroupId),
      });
    }
    return canUndoOutgoing(message, {
      me,
      themReadAt: getThemChatReadAt(this.chatPeerId),
    });
  }

  refreshUndoButtons({ group = false } = {}) {
    if (!this.chatLogEl?.isConnected) return;
    const useGroup = group || Boolean(this.chatGroupId);
    for (const btn of [...this.chatLogEl.querySelectorAll(".chat-undo")]) {
      const host = btn.closest("[data-id]");
      const at = Number(host?.dataset.at) || 0;
      if (!this.canUndoMessage({ id: host?.dataset.id, from: getState().peerId, at }, { group: useGroup })) {
        btn.remove();
      }
    }
  }

  fillCompose(text) {
    const value = String(text || "");
    const key = this.chatGroupId || this.chatPeerId;
    const input = this.composeInput;
    if (input?.isConnected) {
      const cur = input.value.trim();
      input.value = cur ? `${value} ${input.value}` : value;
      if (key) this.composeDrafts.set(key, input.value);
      input.focus();
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch { /* ignore */ }
      if (this.chatPeerId) this.pairNet?.setTyping(this.chatPeerId, Boolean(input.value.trim()));
      return;
    }
    if (key) this.composeDrafts.set(key, value);
  }

  async undoSentMessage(message, { group = false } = {}) {
    if (!message?.id || !this.canUndoMessage(message, { group })) {
      this.refreshUndoButtons({ group });
      return;
    }
    const text = group
      ? await this.pairNet?.undoGroupChat(this.chatGroupId, message.id)
      : await this.pairNet?.undoChat(this.chatPeerId, message.id);
    if (text == null) {
      this.refreshUndoButtons({ group });
      return;
    }
    this.fillCompose(text);
  }

  renderSharedPerson() {
    const peerId = this.personPeerId;
    if (!peerId) {
      this.view = this.homeView();
      return this.view === "friends" ? this.renderFriends() : this.renderStack();
    }
    this.askProfile(peerId);
    const person = this.knownPerson(peerId);
    const me = getState().profile;
    const miles = person ? distanceMiles(me, person) : null;
    const online = this.personIsOnline(peerId);
    const wrap = el("section", { class: "stack-col" },
      el("button", {
        class: "btn secondary",
        type: "button",
        onClick: () => {
          this.personPeerId = null;
          this.view = this.homeView();
          this.render();
        },
      }, "Back"),
      el("h1", {}, person?.handle || "Add friend"),
      el("p", { class: "lede" }, "Add as friend to save their profile and start chatting.")
    );
    if (!person) {
      wrap.append(el("section", { class: "panel empty" },
        el("p", {}, "Connecting to their profile. They need Local Chat open to share the rest of it.")
      ));
      wrap.append(this.friendToggleButton(peerId, { peerId, handle: "" }));
      return wrap;
    }
    wrap.append(el("p", { class: online ? "presence-pill online" : "presence-pill offline" },
      online ? "Online now" : "Showing what we have so far"
    ));
    wrap.append(this.personCard({ ...person, handle: person.handle || "" }, miles, {
      hideHandle: !person.handle,
      full: true,
    }));
    wrap.append(this.friendToggleButton(peerId, person));
    return wrap;
  }

  renderQrSheet() {
    const { peerId, profile } = getState();
    const url = shareUrl(peerId);
    let svg = "";
    try {
      svg = qrSvg(url, { alt: `${profile.handle || APP_NAME} QR code` });
    } catch (err) {
      svg = "";
    }
    const frame = el("div", { class: "qr-frame" });
    if (svg) frame.innerHTML = svg;
    else frame.append(el("p", { class: "disclaimer" }, "Could not draw a QR code. Use the link below."));
    const sheet = el("div", { class: "overlay", id: "qr-sheet", onClick: (e) => {
      if (e.target === sheet) {
        this.qrOpen = false;
        this.render();
      }
    } },
      el("div", { class: "sheet stack-col" },
        el("h2", {}, "Your QR code"),
        el("p", { class: "lede" }, "Someone who scans this opens your profile. If you are already friends, they go straight to chat."),
        frame,
        el("p", { class: "hint share-url" }, url),
        el("div", { class: "row" },
          el("button", {
            class: "btn",
            type: "button",
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(url);
              } catch {
                alert(url);
              }
            },
          }, "Copy link"),
          navigator.share ? el("button", {
            class: "btn secondary",
            type: "button",
            onClick: () => navigator.share({ title: APP_NAME, url }).catch(() => {}),
          }, "Share") : null
        ),
        el("button", {
          class: "btn secondary",
          type: "button",
          onClick: () => {
            this.qrOpen = false;
            this.render();
          },
        }, "Close")
      )
    );
    return sheet;
  }

  renderSettings() {
    const offline = isOffline();
    this.statusEl = el("p", { class: "lede", "aria-live": "polite" });
    this.statusEl.textContent = this.connectionLabel();
    this.locationStatusEl = el("p", { class: "lede" }, this.locationStatusText());
    return el("section", { class: "stack-col" },
      el("section", { class: "panel stack-col" },
        el("h1", {}, "Settings"),
        el("div", { class: "presence-distance-row" },
          el("label", { class: "toggle" },
            el("input", {
              type: "checkbox",
              checked: !offline,
              onChange: (e) => {
                this.setPresenceMode(!e.target.checked);
                this.render();
              },
            }),
            "Online"
          ),
          this.distanceField({ hint: false })
        ),
        el("div", { class: "row location-status" },
          this.locationStatusEl,
          el("button", {
            class: "btn secondary",
            type: "button",
            disabled: this.locating,
            onClick: () => {
              this.error = "";
              this.refreshLocation({ interactive: true, force: true });
              this.render();
            },
          }, this.locating ? "Refreshing…" : "Refresh location"),
          this.locating && this.locateAbort
            ? el("button", {
              class: "btn secondary",
              type: "button",
              onClick: () => this.cancelLocation(),
            }, "Cancel")
            : null
        ),
        this.statusEl,
        el("label", { class: "toggle" },
          el("input", {
            type: "checkbox",
            checked: isPreciseGeolocation(),
            onChange: (e) => {
              this.setPreciseLocation(e.target.checked);
              this.render();
            },
          }),
          "Precise location"
        ),
        el("p", { class: "hint" }, isPreciseGeolocation()
          ? "Choose who can see GPS with the Geo location lock on You. Distances under 2 miles use that. The other person also needs to share a geo location. GPS can still be spoofed."
          : "Others who can see ZIP get your ZIP code, not coordinates. Turn this on to share GPS with a Geo location lock on You, and to use distances under 2 miles."),
        el("p", { class: "hint" }, "Join nearby ZIP rooms so you appear on Online. When this is off, you do not connect to those rooms and you only see and message friends. ZIP comes from this session's GPS fix."),
        this.error ? el("p", { class: "disclaimer" }, this.error) : null
      ),
      el("section", { class: "panel stack-col" },
        el("h2", {}, "Link a device"),
        getLinkedVault()
          ? el("p", { class: "hint" }, "This browser is linked to Local Chat desktop. Every profile, plus friends and chats, sync when both are open. Switch which person is active at the top of You.")
          : el("p", { class: "hint" }, "Scan a QR from Local Chat desktop to share every profile with this browser. Switch which person is active at the top of You."),
        getLinkedVault()
          ? el("button", {
            class: "btn secondary",
            type: "button",
            onClick: () => {
              if (!confirm("Unlink this browser? Your local copy stays here, but it will stop syncing with desktop.")) return;
              this.vaultNet?.stop();
              this.vaultNet = null;
              unlinkVault();
              this.render();
            },
          }, "Unlink desktop")
          : null
      ),
      el("section", { class: "panel stack-col" },
        el("h2", {}, "About"),
        isCanonicalMesh()
          ? null
          : el("p", { class: "hint" }, "DEV MODE"),
        el("p", { class: "disclaimer" }, `${APP_NAME} has no company backend. You only see people who currently have this tab open in a ZIP room within your distance setting. Age and GPS are self-reported and can be spoofed. PeerJS cloud introduces browsers. Photos can be screenshotted.`),
        el("p", { class: "disclaimer" }, "Your identity is a key stored in this browser. Occupying your PeerJS id is not enough to impersonate you. Clearing site data deletes it unless this browser is linked to Local Chat desktop."),
        el("p", { class: "disclaimer" }, "Google Analytics loads only if a measurement ID is configured. Google may see IP and device data. We do not send handles, photos, peer IDs, GPS, ZIP, or date of birth as event parameters."),
        el("p", { class: "disclaimer" }, "If you open the YouTube video list, or a profile video, YouTube loads in this browser. Google may see IP and watch data."),
        el("p", { class: "disclaimer" }, "If you import a LinkedIn data archive, it is read in this browser only. We keep name, headline, profile link, roles, schools, and projects you imported; we do not keep address, birthday, email, or phone from that file. Opening a profile link or photo may still load LinkedIn."),
        el("p", { class: "hint" }, "Testing two accounts on one computer: You → + New, or open ?slot=a and ?slot=b (or an incognito window). Both need Online on, and overlapping looking-for types (public by default)."),
        el("a", { href: "PRIVACY.md" }, "Privacy notes")
      )
    );
  }

  applyRevealedHandle(peerId) {
    const handle = getPair(peerId)?.handle;
    if (!handle) return;
    const saved = getFriend(peerId);
    if (saved && saved.handle !== handle) updateFriend({ ...saved, handle });
  }

  matchHandle(peerId) {
    const person = this.people.find((p) => p.peerId === peerId) || {};
    const pair = getPair(peerId) || {};
    return pair.handle || person.handle || "Someone nearby";
  }

  refreshMatchOverlay(peerId) {
    const rec = this.matchOverlay;
    if (!rec || (peerId && rec.peerId !== peerId)) return;
    if (!rec.overlay.isConnected) {
      this.matchOverlay = null;
      return;
    }
    const person = this.people.find((p) => p.peerId === rec.peerId) || {};
    const handle = this.matchHandle(rec.peerId);
    if (rec.lede) {
      rec.lede.textContent = `You can call them ${handle}. Add as friend saves you on each other's devices. Either of you can remove the friendship.`;
    }
    if (rec.friendSlot) {
      clear(rec.friendSlot);
      rec.friendSlot.append(this.friendToggleButton(rec.peerId, {
        ...person,
        handle: getPair(rec.peerId)?.handle || person.handle || "",
      }));
    }
  }

  showMatch(peerId) {
    this.matchOverlay?.overlay?.remove();
    const person = this.people.find((p) => p.peerId === peerId) || {};
    const handle = this.matchHandle(peerId);
    const lede = el("p", { class: "lede" }, `You can call them ${handle}. Add as friend saves you on each other's devices. Either of you can remove the friendship.`);
    const friendSlot = el("div", { class: "stack-col" }, this.friendToggleButton(peerId, {
      ...person,
      handle: getPair(peerId)?.handle || person.handle || "",
    }));
    const overlay = el("div", { class: "overlay", id: "match-sheet" },
      el("div", { class: "sheet stack-col" },
        el("h1", {}, "It's a match"),
        lede,
        person.photo ? el("img", { class: "photo-preview", src: person.photo, alt: handle }) : null,
        friendSlot,
        el("button", {
          class: "btn secondary",
          type: "button",
          onClick: () => {
            overlay.remove();
            this.matchOverlay = null;
          },
        }, "Close")
      )
    );
    this.matchOverlay = { peerId, overlay, lede, friendSlot };
    document.body.append(overlay);
  }

  showTurnFailed(info) {
    document.getElementById("turn-failed-sheet")?.remove();
    const overlay = el("div", { class: "overlay", id: "turn-failed-sheet" },
      el("div", { class: "sheet stack-col" },
        el("h2", {}, "Could not save this update"),
        el("p", { class: "lede" }, info?.message || "The other person could not save, so your change was reverted."),
        el("button", {
          class: "btn",
          type: "button",
          onClick: () => overlay.remove(),
        }, "OK")
      )
    );
    document.body.append(overlay);
    this.render();
  }
}
