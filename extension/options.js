// The options page: shows the configuration in use. When the organisation sets it by Chrome policy, the page is
// read-only and lists any setting that could not be used; otherwise the person can paste their own, which is saved only
// when every button in it is usable.
import { readConfig } from "./buttons.js";

const $ = (id) => document.getElementById(id);
const managed = await chrome.storage.managed.get(null).catch(() => ({}));
const fromPolicy = Object.keys(managed).length > 0;
const show = (lines, bad) => {
  $("result").replaceChildren(
    ...lines.map((line) => {
      const d = document.createElement("div");
      d.textContent = line;
      return d;
    }),
  );
  $("result").className = bad ? "err" : "";
};

if (fromPolicy) {
  $("where").textContent = "Your organisation sets these buttons by Chrome policy, so they cannot be changed here.";
  $("config").value = JSON.stringify(managed, null, 2);
  $("config").readOnly = true;
  $("save").hidden = true;
  const { problems } = readConfig(managed);
  if (problems.length > 0) show(["Not used:", ...problems], true);
} else {
  $("where").textContent = "No organisation sets these buttons on this computer, so you can set your own.";
  const { config } = await chrome.storage.sync.get("config");
  if (config) $("config").value = JSON.stringify(config, null, 2);
  $("save").addEventListener("click", async () => {
    let parsed;
    try {
      parsed = JSON.parse($("config").value);
    } catch (e) {
      show([`Not saved: this is not valid JSON (${e.message}).`], true);
      return;
    }
    const { buttons, problems } = readConfig(parsed);
    if (problems.length > 0) {
      show(["Not saved:", ...problems], true);
      return;
    }
    await chrome.storage.sync.set({ config: parsed });
    show([`Saved: ${buttons.length} button(s).`], false);
  });
}
