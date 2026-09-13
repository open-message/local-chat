import { GA_MEASUREMENT_ID } from "./config.js";

let ready = false;

export function initAnalytics() {
  if (!GA_MEASUREMENT_ID || !GA_MEASUREMENT_ID.startsWith("G-")) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.append(script);
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
  ready = true;
}

export function track(name, params = {}) {
  if (!ready || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}

window.addEventListener("appinstalled", () => {
  track("pwa_installed");
});
