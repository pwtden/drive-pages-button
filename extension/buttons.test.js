import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buttonProblem, buttonsFor, LIMITS, readConfig, WHEN, whatIsOpen } from "./buttons.js";

// Made-up ids only.
const F = "1MADEUPFOLDERID0000";
const D = "1MADEUPDOCUMENTID000";
const here = import.meta.dir;
const example = JSON.parse(readFileSync(join(here, "..", "examples", "example-config.json"), "utf8"));

describe("whatIsOpen: the folder or file a tab's address points at", () => {
  test("Drive folders, with or without an account number", () => {
    expect(whatIsOpen(`https://drive.google.com/drive/folders/${F}`)).toEqual({ folder: F });
    expect(whatIsOpen(`https://drive.google.com/drive/u/1/folders/${F}?resourcekey=x`)).toEqual({ folder: F });
    expect(whatIsOpen("https://drive.google.com/drive/folders/0AMADEUPSHAREDDRIVE")).toEqual({ folder: "0AMADEUPSHAREDDRIVE" });
  });
  test("Docs, Sheets, Slides, Drawings, Drive's file viewer and open?id=", () => {
    for (const kind of ["document", "spreadsheets", "presentation", "drawings"]) {
      expect(whatIsOpen(`https://docs.google.com/${kind}/d/${D}/edit#gid=0`)).toEqual({ file: D });
      expect(whatIsOpen(`https://docs.google.com/${kind}/u/0/d/${D}/edit`)).toEqual({ file: D });
    }
    expect(whatIsOpen(`https://drive.google.com/file/d/${D}/view`)).toEqual({ file: D });
    expect(whatIsOpen(`https://drive.google.com/open?usp=x&id=${D}`)).toEqual({ file: D });
  });
  test("anything else is neither: another site, a look-alike host, http, a short id, nothing at all", () => {
    for (const u of [
      `https://example.com/drive/folders/${F}`,
      `https://docs.google.com.evil.example/document/d/${D}/edit`,
      `http://docs.google.com/document/d/${D}/edit`,
      "https://drive.google.com/drive/folders/short",
      "https://drive.google.com/drive/my-drive",
      "chrome://newtab/",
      "",
      undefined,
    ]) {
      expect(whatIsOpen(u)).toEqual({});
    }
  });
});

describe("buttonProblem: what makes one configured button unusable", () => {
  const ok = { label: "Open", when: "always", url: "https://pages.example.com/" };
  test("a complete button is usable, and when defaults to always", () => {
    expect(buttonProblem(ok)).toBeNull();
    expect(buttonProblem({ label: "Open", url: "https://pages.example.com/" })).toBeNull();
    expect(buttonProblem({ label: "Here", when: "folder", url: "https://p.example.com/x?f={folderId}" })).toBeNull();
    expect(buttonProblem({ label: "This", when: "file", url: "https://p.example.com/e/{fileId}" })).toBeNull();
  });
  test("each missing or wrong part is named", () => {
    expect(buttonProblem(null)).toBe("not an object");
    expect(buttonProblem([ok])).toBe("not an object");
    expect(buttonProblem({ ...ok, label: "  " })).toBe("no label");
    expect(buttonProblem({ ...ok, label: "x".repeat(LIMITS.label + 1) })).toContain("longer than");
    expect(buttonProblem({ ...ok, when: "page" })).toContain('"when" must be');
    expect(buttonProblem({ ...ok, url: "" })).toBe("no url");
    expect(buttonProblem({ ...ok, url: "not an address" })).toBe("not a valid address");
  });
  test("only https: never http, javascript:, data: or a file", () => {
    for (const url of ["http://pages.example.com/", "javascript:alert(1)", "data:text/html,x", "file:///etc/hosts"]) {
      expect(buttonProblem({ ...ok, url })).toMatch(/https|valid/);
    }
  });
  test("a placeholder only where its id exists: {folderId} on folders, {fileId} on files, none on always", () => {
    expect(buttonProblem({ ...ok, url: "https://p.example.com/{folderId}" })).toContain("{folderId} cannot be used");
    expect(buttonProblem({ ...ok, when: "folder", url: "https://p.example.com/{fileId}" })).toContain("{fileId} cannot be used");
    expect(buttonProblem({ ...ok, when: "file", url: "https://p.example.com/{token}" })).toContain("{token} cannot be used");
  });
});

describe("readConfig: what the popup can use", () => {
  test("the example configuration is fully usable", () => {
    const c = readConfig(example);
    expect(c.problems).toEqual([]);
    expect(c.buttons.length).toBe(example.buttons.length);
    expect(c.title).toBe(example.title);
  });
  test("bad buttons are left out with a reason, good ones keep their order", () => {
    const c = readConfig({
      buttons: [
        { label: "A", url: "https://a.example.com/" },
        { label: "B", url: "http://b.example.com/" },
        { label: "C", url: "https://c.example.com/" },
      ],
    });
    expect(c.buttons.map((b) => b.label)).toEqual(["A", "C"]);
    expect(c.problems).toEqual(["button 2: only https addresses are allowed"]);
  });
  test("no configuration, or not an object, is no buttons and says so", () => {
    for (const raw of [undefined, null, "x", [], {}]) {
      const c = readConfig(raw);
      expect(c.buttons).toEqual([]);
      expect(c.problems).toContain("no buttons list");
    }
  });
  test("title and note are trimmed and capped; at most the first buttons are used", () => {
    const many = Array.from({ length: LIMITS.buttons + 3 }, (_, i) => ({ label: `B${i}`, url: "https://x.example.com/" }));
    const c = readConfig({ title: ` ${"t".repeat(80)} `, note: "n".repeat(300), buttons: many });
    expect(c.title.length).toBe(LIMITS.title);
    expect(c.note.length).toBe(LIMITS.note);
    expect(c.buttons.length).toBe(LIMITS.buttons);
    expect(c.problems).toContain(`only the first ${LIMITS.buttons} buttons are used`);
  });
});

describe("buttonsFor: the buttons shown for the page in front of the person", () => {
  const config = readConfig(example);
  test("on a folder: the folder buttons, then always, with the id filled in", () => {
    const got = buttonsFor(config, `https://drive.google.com/drive/folders/${F}`);
    expect(got.map((b) => b.label)).toEqual(["Upload files to this folder", "Make a new document in this folder", "All our pages"]);
    expect(got[0].href).toBe(`https://pages.example.com/upload?folder=${F}`);
  });
  test("on a file: the file buttons, then always", () => {
    const got = buttonsFor(config, `https://docs.google.com/document/d/${D}/edit`);
    expect(got.map((b) => b.label)).toEqual(["Edit this file", "Copy this file into a folder", "All our pages"]);
    expect(got[0].href).toBe(`https://pages.example.com/edit?file=${D}`);
  });
  test("anywhere else: only the always buttons", () => {
    expect(buttonsFor(config, "https://example.com/").map((b) => b.label)).toEqual(["All our pages"]);
    expect(buttonsFor(config, undefined).map((b) => b.label)).toEqual(["All our pages"]);
  });
  test("an id is encoded before it reaches an address", () => {
    const c = readConfig({ buttons: [{ label: "X", when: "folder", url: "https://p.example.com/{folderId}" }] });
    expect(buttonsFor(c, `https://drive.google.com/drive/folders/${F}`)[0].href).toBe(`https://p.example.com/${encodeURIComponent(F)}`);
  });
});

describe("the package: manifest, schema and files agree", () => {
  const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
  const schema = JSON.parse(readFileSync(join(here, "managed_schema.json"), "utf8"));
  test("two permissions only: the tab in front, on a click, and storage to read the policy", () => {
    expect(manifest.permissions).toEqual(["activeTab", "storage"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
  });
  test("the store's description limit, 132 characters", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });
  test("every file the manifest names exists", () => {
    const files = [
      manifest.action.default_popup,
      manifest.options_ui.page,
      manifest.storage.managed_schema,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    for (const f of files) expect(existsSync(join(here, f))).toBe(true);
  });
  test("the policy schema names exactly the settings readConfig reads", () => {
    expect(Object.keys(schema.properties).toSorted()).toEqual(["buttons", "note", "title"]);
    expect(Object.keys(schema.properties.buttons.items.properties).toSorted()).toEqual(["label", "url", "when"]);
    expect(Object.keys(WHEN).toSorted()).toEqual(["always", "file", "folder"]);
  });
});
