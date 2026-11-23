#!/usr/bin/env bun
// verify-in-real-chrome: run the popup and the options page in real headless Chrome and check what a person sees and
// what each button opens, with the configuration from Chrome policy, from the options page, or from nowhere.
//
// Branded Google Chrome no longer loads an unpacked extension from the command line, so the extension's own files are
// served as they are and the Chrome APIs they use are stood in for: chrome.tabs (the tab in front, the tab opened),
// chrome.storage.managed (the policy), chrome.storage.sync (the options page) and chrome.runtime.openOptionsPage.
// The manifest is checked by buttons.test.js and by the Chrome Web Store when the package is uploaded.
//
//   bun scripts/verify-in-real-chrome.js [--chrome <path>]   # exit 0 every check passed · 1 a check failed · 2 could not look
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CHROME, startChrome } from "./cdp.js";

const { values: args } = parseArgs({ options: { chrome: { type: "string", default: DEFAULT_CHROME } }, strict: true });
const DIR = resolve(import.meta.dir, "../extension");
const EXAMPLE = JSON.parse(readFileSync(resolve(import.meta.dir, "../examples/example-config.json"), "utf8"));
const FOLDER = "1MADEUPFOLDERID0000";
const FILE = "1MADEUPDOCUMENTID000";

async function main() {
  const failures = [];
  const check = (ok, what) => {
    console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
    if (!ok) failures.push(what);
  };
  let h;
  try {
    h = await startChrome(DIR, args.chrome);
  } catch (e) {
    console.error(`✗ could not look: ${e.message}`);
    return 2;
  }
  const { page, evaluate, open } = h;
  const until = async (expression, what) => {
    if (await h.until(expression)) return true;
    check(false, `timed out waiting for ${what}`);
    return false;
  };
  try {
    const labels = `[...document.querySelectorAll("#buttons button")].map((b) => b.textContent)`;

    console.log("▶ popup, configured by policy, on a Drive folder");
    await open("popup.html", { tab: `https://drive.google.com/drive/folders/${FOLDER}`, managed: EXAMPLE });
    await until(`document.querySelectorAll("#buttons button").length > 0`, "the popup's buttons");
    check(
      JSON.stringify(await evaluate(labels)) ===
        JSON.stringify(["Upload files to this folder", "Make a new document in this folder", "All our pages"]),
      "the two folder buttons, then the always button, in the configured order",
    );
    check((await evaluate(`document.getElementById("title").textContent`)) === EXAMPLE.title, "the policy's title is the heading");
    await evaluate(`document.querySelector("#buttons button").click()`);
    await until(`window.__opened.length > 0`, "the first button to open a tab");
    check(
      (await evaluate(`window.__opened[0]`)) === `https://pages.example.com/upload?folder=${FOLDER}`,
      "the first button opens its page with the folder id",
    );
    check((await evaluate(`window.__closed === true`)) === true, "the popup closes after opening the page");

    console.log("▶ popup, configured by policy, on a Google Doc");
    await open("popup.html", { tab: `https://docs.google.com/document/d/${FILE}/edit`, managed: EXAMPLE });
    await until(`document.querySelectorAll("#buttons button").length > 0`, "the popup's buttons");
    check(
      JSON.stringify(await evaluate(labels)) === JSON.stringify(["Edit this file", "Copy this file into a folder", "All our pages"]),
      "the two file buttons, then the always button",
    );

    console.log("▶ popup, a policy with one unusable button");
    const bad = { ...EXAMPLE, buttons: [...EXAMPLE.buttons, { label: "Old page", url: "http://old.example.com/" }] };
    await open("popup.html", { tab: "https://example.com/", managed: bad });
    await until(`document.getElementById("warn").textContent.length > 0`, "the warning");
    check(JSON.stringify(await evaluate(labels)) === JSON.stringify(["All our pages"]), "the usable buttons still show");
    check(
      (await evaluate(`document.getElementById("warn").textContent`)).startsWith("1 setting(s) could not be used"),
      "it says one setting was not used",
    );

    console.log("▶ popup, no policy, the person's own configuration");
    const own = { title: "My pages", buttons: [{ label: "My page", url: "https://mine.example.com/" }] };
    await open("popup.html", { tab: "https://example.com/", own });
    await until(`document.querySelectorAll("#buttons button").length > 0`, "the popup's buttons");
    check(JSON.stringify(await evaluate(labels)) === JSON.stringify(["My page"]), "the options page's configuration is used");

    console.log("▶ popup, nothing configured");
    await open("popup.html", { tab: "https://example.com/" });
    await until(`document.getElementById("warn").textContent.length > 0`, "the not-set-up note");
    check((await evaluate(`document.getElementById("warn").textContent`)) === "Not set up yet.", "it says it is not set up");
    await evaluate(`document.querySelector("#buttons button").click()`);
    check((await evaluate(`window.__options`)) === 1, '"Set it up" opens the options page');

    console.log("▶ options page under a policy");
    await open("options.html", { managed: bad });
    await until(`document.getElementById("where").textContent.length > 0`, "the options page");
    check((await evaluate(`document.getElementById("config").readOnly`)) === true, "the configuration is read-only");
    check((await evaluate(`document.getElementById("save").hidden`)) === true, "there is no Save button");
    check(
      (await evaluate(`document.getElementById("result").textContent`)).includes("button 6: only https addresses are allowed"),
      "it names the unused button and why",
    );

    console.log("▶ options page, no policy");
    await open("options.html", {});
    await until(`document.getElementById("where").textContent.length > 0`, "the options page");
    await evaluate(`document.getElementById("config").value = "{ not json"; document.getElementById("save").click()`);
    await until(`document.getElementById("result").textContent.length > 0`, "the save result");
    check(
      (await evaluate(`document.getElementById("result").textContent`)).startsWith("Not saved: this is not valid JSON"),
      "invalid JSON is not saved",
    );
    await evaluate(
      `document.getElementById("config").value = ${JSON.stringify(JSON.stringify(bad))}; document.getElementById("result").textContent = ""; document.getElementById("save").click()`,
    );
    await until(`document.getElementById("result").textContent.length > 0`, "the save result");
    check(
      (await evaluate(`document.getElementById("result").textContent`)).startsWith("Not saved:") &&
        (await evaluate(`window.__saved.length`)) === 0,
      "a configuration with an unusable button is not saved",
    );
    await evaluate(
      `document.getElementById("config").value = ${JSON.stringify(JSON.stringify(EXAMPLE))}; document.getElementById("result").textContent = ""; document.getElementById("save").click()`,
    );
    await until(`document.getElementById("result").textContent.length > 0`, "the save result");
    check((await evaluate(`document.getElementById("result").textContent`)) === "Saved: 5 button(s).", "a usable configuration is saved");
    check((await evaluate(`window.__saved.length`)) === 1, "exactly one write to the person's storage");
    page.close();
  } catch (e) {
    console.error(`✗ could not look: ${e.message}`);
    return 2;
  } finally {
    await h.stop();
  }
  console.log(failures.length ? `✗ ${failures.length} check(s) failed` : "✓ every check passed in real Chrome");
  return failures.length ? 1 : 0;
}

process.exit(await main());
