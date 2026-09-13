import { initAnalytics, track } from "./analytics.js";
import { APP_NAME } from "./config.js";
import { loadZips } from "./geo.js";
import { App } from "./ui/app.js";

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Missing ${path}`);
  return res.json();
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  const https = location.protocol === "https:";
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!https && !local) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch {
    /* ignore */
  }
}

async function boot() {
  initAnalytics();
  track("page_view");
  registerWorker();
  const [tags, questionnaire] = await Promise.all([
    loadJson("data/tags.json"),
    loadJson("data/questionnaire.json"),
    loadZips().catch(() => null),
  ]);
  const app = new App({ tags, questions: questionnaire.questions });
  await app.start();
}

boot().catch((err) => {
  document.getElementById("main").textContent = err.message || `${APP_NAME} failed to start.`;
});
