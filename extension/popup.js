// The popup: reads the address of the tab the person is on (the activeTab permission, granted only when they click the
// button) and lists the configured buttons that fit it. Each opens its page in a new tab, or in the tab the person is on
// when the button says "tab": "same". The organisation's Chrome policy wins; without one, the person's own configuration
// from the options page is used. Keyboard: the popup opens with Alt+Shift+D (the manifest's suggested shortcut), the
// first button has the focus (Enter presses it), and the digits 1 to 9 press the button of that number.
import { buttonsFor, readConfig } from "./buttons.js";

const $ = (id) => document.getElementById(id);
const managed = await chrome.storage.managed.get(null).catch(() => ({}));
const fromPolicy = Object.keys(managed).length > 0;
const raw = fromPolicy ? managed : (await chrome.storage.sync.get("config")).config;
const config = readConfig(raw);

if (config.title) $("title").textContent = config.title;
if (config.note) $("note").textContent = config.note;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const shown = buttonsFor(config, tab?.url);
for (const c of shown) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = c.label;
  b.addEventListener("click", async () => {
    if (c.tab === "same" && tab?.id !== undefined) await chrome.tabs.update(tab.id, { url: c.href });
    else await chrome.tabs.create({ url: c.href });
    window.close();
  });
  $("buttons").append(b);
}
const pressable = [...$("buttons").querySelectorAll("button")];
pressable[0]?.focus();
document.addEventListener("keydown", (e) => {
  const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
  if (n && pressable[n - 1] && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    pressable[n - 1].click();
  }
});

if (config.buttons.length === 0) {
  $("warn").textContent = fromPolicy
    ? "Your organisation's settings for this button have no usable buttons. Please tell whoever looks after your computers."
    : "Not set up yet.";
  if (!fromPolicy) {
    const setUp = document.createElement("button");
    setUp.type = "button";
    setUp.textContent = "Set it up";
    setUp.addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("buttons").append(setUp);
  }
} else if (config.problems.length > 0) {
  $("warn").textContent = `${config.problems.length} setting(s) could not be used; the options page says which.`;
}
