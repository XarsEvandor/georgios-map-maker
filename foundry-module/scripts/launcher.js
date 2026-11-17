/**
 * Georgios' launcher, from Foundry: the Companions dialog (who is running, Start buttons) and the
 * "start it?" offer when a companion does not answer. A browser cannot start programs; the
 * launcher (georgios-launcher on the GM's PC, started at login) does it on request.
 */

import { MODULE_ID } from "./lib.js";

const t = (key, data) => (data ? game.i18n.format(`GMM.Launcher.${key}`, data) : game.i18n.localize(`GMM.Launcher.${key}`));
const base = () => (game.settings.get(MODULE_ID, "launcherUrl") || "http://127.0.0.1:47100").replace(/\/+$/, "");

export async function launcherStatus() {
  const res = await fetch(`${base()}/status`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `launcher answered ${res.status}`);
  return body;
}

export async function launcherStart(service) {
  const res = await fetch(`${base()}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `launcher answered ${res.status}`);
  return body;
}

/** Starts a service and tells the GM when it answers (up to three minutes). */
export async function startAndWait(service) {
  let status;
  try {
    status = await launcherStatus();
  } catch {
    ui.notifications.error(t("NoLauncher"), { permanent: true });
    return false;
  }
  const name = status.services?.[service]?.name ?? service;
  if (status.services?.[service]?.up) {
    ui.notifications.info(t("AlreadyRunning", { name }));
    return true;
  }
  try {
    await launcherStart(service);
  } catch (e) {
    ui.notifications.error(`${t("Title")}: ${e.message}`);
    return false;
  }
  ui.notifications.info(t("Starting", { name }));
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      if ((await launcherStatus()).services?.[service]?.up) {
        ui.notifications.info(t("Ready", { name }));
        return true;
      }
    } catch {
      /* launcher busy; ask again */
    }
  }
  ui.notifications.warn(t("Slow", { name }));
  return false;
}

const offered = new Map(); // service -> when the GM last saw the offer

/** Offers to start a companion that did not answer (once a minute at most). */
export async function offerStart(service, name) {
  if (!game.user.isGM) return;
  const last = offered.get(service);
  if (last && Date.now() - last < 60_000) return;
  offered.set(service, Date.now());
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("Title") },
    content: `<p>${t("NotRunning", { name })}</p>`,
    yes: { label: t("Start"), icon: "fa-solid fa-play" },
    no: { label: t("NotNow") },
    rejectClose: false,
  });
  if (yes) await startAndWait(service);
}

/** The Companions dialog: each service's state and a Start button for those not running. */
export async function openCompanions() {
  const DialogV2 = foundry.applications.api.DialogV2;
  let status;
  try {
    status = await launcherStatus();
  } catch {
    return DialogV2.prompt({ window: { title: t("Title") }, content: `<p>${t("NoLauncher")}</p>` });
  }
  const rows = Object.entries(status.services).map(([id, s]) => {
    const state = s.up ? t("Running") : s.starting ? t("StartingShort") : t("Stopped");
    return `<tr><td>${foundry.utils.escapeHTML(s.name)}</td><td>${state}</td></tr>`;
  }).join("");
  const gpu = status.gpu?.holder ? t("GpuBusy", { owner: status.gpu.holder.owner }) : t("GpuFree");
  const buttons = Object.entries(status.services).filter(([, s]) => !s.up && !s.starting)
    .map(([id, s]) => ({ action: id, label: t("StartName", { name: s.name }), icon: "fa-solid fa-play" }));
  buttons.push({ action: "refresh", label: t("Refresh"), icon: "fa-solid fa-rotate" }, { action: "close", label: t("Close"), default: true });
  const picked = await DialogV2.wait({
    window: { title: t("Title") },
    content: `<table><tbody>${rows}</tbody></table><p>${gpu}</p>`,
    buttons,
    rejectClose: false,
  });
  if (!picked || picked === "close") return;
  if (picked !== "refresh") await startAndWait(picked);
  return openCompanions();
}
