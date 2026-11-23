// Which buttons the popup shows for the page in front of the person. Pure: it reads a tab's address and the
// configuration (from the organisation's Chrome policy, or the person's own options page) and builds links. It calls no
// service and holds no secret; the pages it opens do their own sign-in and their own checks.

const ID = "([\\w-]{10,})";
const FOLDER = new RegExp(`^https://drive\\.google\\.com/drive/(?:u/\\d+/)?folders/${ID}`);
const FILE = [
  new RegExp(`^https://docs\\.google\\.com/(?:document|spreadsheets|presentation|drawings)/(?:u/\\d+/)?d/${ID}`),
  new RegExp(`^https://drive\\.google\\.com/file/(?:u/\\d+/)?d/${ID}`),
  new RegExp(`^https://drive\\.google\\.com/open\\?(?:.*&)?id=${ID}`),
];

/** What the address points at: a Drive folder, a file, or neither. */
export function whatIsOpen(url) {
  const u = String(url ?? "");
  const folder = u.match(FOLDER);
  if (folder) return { folder: folder[1] };
  const file = FILE.map((pattern) => u.match(pattern)).find(Boolean);
  return file ? { file: file[1] } : {};
}

/** When a button shows, and the one placeholder its address may carry there. */
export const WHEN = { folder: "folderId", file: "fileId", always: null };
const PLACEHOLDER = /\{(\w+)\}/g;
export const LIMITS = { title: 60, note: 200, label: 60, buttons: 20 };
/** Where a button opens its page: a new tab (the default), or the tab the person is on ("same"), so that a page which
 *  finishes by itself can bring them straight back to the file or folder they were looking at. */
export const TABS = ["new", "same"];

/** Why one configured button cannot be used, or null when it can. Pure. */
export function buttonProblem(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "not an object";
  if (typeof b.label !== "string" || !b.label.trim()) return "no label";
  if (b.label.trim().length > LIMITS.label) return `label longer than ${LIMITS.label} characters`;
  const when = b.when ?? "always";
  if (!Object.hasOwn(WHEN, when)) return '"when" must be "folder", "file" or "always"';
  if (b.tab !== undefined && !TABS.includes(b.tab)) return '"tab" must be "new" or "same"';
  if (typeof b.url !== "string" || !b.url.trim()) return "no url";
  const wrong = [...b.url.matchAll(PLACEHOLDER)].map((m) => m[1]).find((name) => name !== WHEN[when]);
  if (wrong) return `{${wrong}} cannot be used when "when" is "${when}"`;
  let parsed;
  try {
    parsed = new URL(b.url.replace(PLACEHOLDER, "x"));
  } catch {
    return "not a valid address";
  }
  if (parsed.protocol !== "https:") return "only https addresses are allowed";
  return null;
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A configuration as the popup uses it: the valid buttons in their order, and a reason for each one left out. Pure. */
export function readConfig(raw) {
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const problems = [];
  if (!Array.isArray(cfg.buttons)) problems.push("no buttons list");
  const list = Array.isArray(cfg.buttons) ? cfg.buttons : [];
  if (list.length > LIMITS.buttons) problems.push(`only the first ${LIMITS.buttons} buttons are used`);
  const buttons = [];
  list.slice(0, LIMITS.buttons).forEach((b, i) => {
    const why = buttonProblem(b);
    if (why) problems.push(`button ${i + 1}: ${why}`);
    else buttons.push({ label: b.label.trim(), when: b.when ?? "always", url: b.url.trim(), tab: b.tab ?? "new" });
  });
  return { title: text(cfg.title, LIMITS.title), note: text(cfg.note, LIMITS.note), buttons, problems };
}

/** The buttons for that page, in the configured order: each label, the address it opens, and in which tab. Pure. */
export function buttonsFor(config, url) {
  const open = whatIsOpen(url);
  const ids = { folderId: open.folder, fileId: open.file };
  return config.buttons
    .filter((b) => b.when === "always" || (b.when === "folder" && open.folder) || (b.when === "file" && open.file))
    .map((b) => ({ label: b.label, href: b.url.replace(PLACEHOLDER, (_, name) => encodeURIComponent(ids[name])), tab: b.tab ?? "new" }));
}
