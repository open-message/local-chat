import { haversineMiles } from "./geo.js";
import { seekingLists } from "./profile.js";
import { getState } from "./store.js";

function set(list) {
  return new Set((list || []).map((x) => String(x).toLowerCase()));
}

export function jaccard(a, b) {
  const A = set(a);
  const B = set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function questionnaireAgreement(mine, theirs, questions) {
  if (!mine || !theirs) return 0;
  let same = 0;
  let n = 0;
  for (const q of questions || []) {
    if (mine[q.id] && theirs[q.id]) {
      n += 1;
      if (mine[q.id] === theirs[q.id]) same += 1;
    }
  }
  return n ? same / n : 0;
}

export function seeksEveryone(seeking) {
  return Boolean(seeking?.includes("everyone"));
}

export function genderSeekCompatible(mySeek, theirGender, theirSeek, myGender) {
  if (!mySeek?.length || !theirSeek?.length) return false;
  const iSeekThem = seeksEveryone(mySeek) || mySeek.includes(theirGender);
  const theySeekMe = seeksEveryone(theirSeek) || theirSeek.includes(myGender);
  return iSeekThem && theySeekMe;
}

export function overlapIntents(me, them) {
  const mine = seekingLists(me);
  const theirs = seekingLists(them);
  const overlap = [];
  if (genderSeekCompatible(mine.relationships, them.gender, theirs.relationships, me.gender)) {
    overlap.push("relationships");
  }
  if (genderSeekCompatible(mine.friendships, them.gender, theirs.friendships, me.gender)) {
    overlap.push("friendships");
  }
  if (mine.networking.length && theirs.networking.length) overlap.push("networking");
  const mineMusician = Boolean(mine.musicianSeekingBand.length || mine.musicianInstruments.length);
  const theirsMusician = Boolean(theirs.musicianSeekingBand.length || theirs.musicianInstruments.length);
  if (mineMusician && (theirs.bandSeekingMusician.length || theirsMusician)) {
    overlap.push("musician-seeking-band");
  }
  if (mine.bandSeekingMusician.length && (theirsMusician || theirs.bandSeekingMusician.length)) {
    overlap.push("band-seeking-musician");
  }
  return overlap;
}

export function compatible(me, them, intentFilter) {
  const overlap = overlapIntents(me, them);
  if (!intentFilter?.length) return overlap.length > 0;
  return overlap.some((intent) => intentFilter.includes(intent));
}

function visibleIntents(me, them, intentFilter) {
  const overlap = overlapIntents(me, them);
  if (!intentFilter?.length) return overlap;
  return overlap.filter((intent) => intentFilter.includes(intent));
}

export function distanceMiles(me, them) {
  if (!me?.loc || !them?.loc) return null;
  return haversineMiles(me.loc.lat, me.loc.lng, them.loc.lat, them.loc.lng);
}

export function formatMilesLabel(miles) {
  if (miles == null || !Number.isFinite(Number(miles))) return "";
  const n = Number(miles);
  if (n < 0.03) return "Nearby";
  if (n < 0.2) return `${Math.max(1, Math.round(n * 5280))} ft`;
  if (n < 1) return `${n.toFixed(2)} miles`;
  if (n < 10) return `${n.toFixed(1)} miles`;
  return `${Math.round(n)} miles`;
}

export function inDistance(me, them, milesOption) {
  if (milesOption === "all") return true;
  const d = distanceMiles(me, them);
  // Roster people are already in overlapping ZIP rooms. A hidden location
  // must not drop them; fine distance is only applied when both share loc.
  if (d == null) return true;
  return d <= Number(milesOption);
}

function peopleFilterMode(filters) {
  const mode = filters?.peopleFilter;
  if (mode === "connected" || mode === "friends" || mode === "all") return mode;
  return filters?.interestedOnly ? "connected" : "all";
}

export function scorePerson(me, them, questions) {
  const filters = getState().filters;
  const w = Number(filters.interestWeight ?? 0.7);
  const interest = jaccard(me.interests, them.interests);
  const hobbies = jaccard(me.hobbies, them.hobbies);
  const antiHit =
    jaccard(me.antiInterests, them.interests) + jaccard(them.antiInterests, me.interests);
  const q = questionnaireAgreement(me.questionnaire, them.questionnaire, questions);
  const dist = distanceMiles(me, them);
  const distScore = dist == null ? 0 : Math.max(0, 1 - dist / 50);
  const overlap = overlapIntents(me, them).length;
  return (
    interest * (0.4 + w * 0.5) +
    hobbies * 0.25 +
    q * 0.25 +
    distScore * 0.15 +
    overlap * 0.2 -
    antiHit * 0.8
  );
}

export function filterAndRank(me, people, questions) {
  const filters = getState().filters;
  const interested = new Set(getState().interestedPeerIds);
  const friendIds = new Set((getState().friends || []).map((f) => f.peerId));
  const intents = filters.intents || [];
  return people
    .filter((p) => p.peerId !== getState().peerId)
    .filter((p) => (p.age == null ? true : p.age >= filters.minAge && p.age <= filters.maxAge))
    .filter((p) => visibleIntents(me, p, intents).length > 0)
    .filter((p) => inDistance(me, p, filters.distance))
    .filter((p) => {
      const mode = peopleFilterMode(filters);
      if (mode === "connected") return interested.has(p.peerId);
      if (mode === "friends") return friendIds.has(p.peerId);
      return true;
    })
    .map((p) => ({ person: p, score: scorePerson(me, p, questions), miles: distanceMiles(me, p) }))
    .sort((a, b) => b.score - a.score);
}
