#!/usr/bin/env bun
// preview-popup: see the popup a person will see, with YOUR configuration, on a page you name, before rolling it out.
// Renders the real popup in headless Chrome (the same stand-ins as verify-in-real-chrome.js), prints its title, its
// buttons with the address each one opens, and any setting it could not use, and saves a picture of it.
//
//   bun scripts/preview-popup.js --config <your-config.json> --tab <an address> [--out popup.png] [--own] [--chrome <path>]
//
//   --config  the configuration, in the same shape as examples/example-config.json (what Chrome policy will hold)
//   --tab     the address of the page in front, e.g. a Drive folder or a Google Doc you open every day
//   --out     where to save the picture (default: popup.png in the current folder)
//   --own     treat the configuration as the person's own (options page) instead of the organisation's (policy)
//
// Exit 0 the popup showed its buttons · 1 it showed none, or some settings could not be used · 2 could not look.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CHROME, startChrome } from "./cdp.js";

const { values: args } = parseArgs({
  options: {
    config: { type: "string" },
    tab: { type: "string" },
    out: { type: "string", default: "popup.png" },
    own: { type: "boolean", default: false },
    chrome: { type: "string", default: DEFAULT_CHROME },
  },
  strict: true,
});

async function main() {
  if (!args.config || !args.tab) {
    console.error("usage: bun scripts/preview-popup.js --config <file.json> --tab <address> [--out popup.png] [--own] [--chrome <path>]");
    return 2;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(args.config, "utf8"));
  } catch (e) {
    console.error(`✗ could not look: ${args.config} is not readable JSON (${e.message})`);
    return 2;
  }
  let h;
  try {
    h = await startChrome(resolve(import.meta.dir, "../extension"), args.chrome);
  } catch (e) {
    console.error(`✗ could not look: ${e.message}`);
    return 2;
  }
  try {
    await h.open("popup.html", args.own ? { tab: args.tab, own: config } : { tab: args.tab, managed: config });
    await h.until(`document.querySelectorAll("#buttons button").length > 0 || document.getElementById("warn").textContent.length > 0`);
    const title = await h.evaluate(`document.getElementById("title").textContent`);
    const warn = await h.evaluate(`document.getElementById("warn").textContent`);
    const labels = await h.evaluate(`[...document.querySelectorAll("#buttons button")].map((b) => b.textContent)`);
    // Each button's address, read by pressing it: the stand-in for chrome.tabs.create records it, nothing is opened.
    const opens = [];
    for (let n = 0; n < labels.length; n += 1) {
      await h.open("popup.html", args.own ? { tab: args.tab, own: config } : { tab: args.tab, managed: config });
      await h.until(`document.querySelectorAll("#buttons button").length > ${n}`);
      await h.evaluate(`document.querySelectorAll("#buttons button")[${n}].click()`);
      await h.until(`window.__opened.length > 0 || window.__options > 0`);
      opens.push(await h.evaluate(`window.__opened[0] || (window.__options ? "(the options page)" : "")`));
    }
    // The picture is of the popup at the size Chrome gives it: shrunk to fit its content (Chrome sizes an extension popup
    // to the page's preferred width, at least the popup's own min-width), taken after one last fresh open.
    await h.open("popup.html", args.own ? { tab: args.tab, own: config } : { tab: args.tab, managed: config });
    await h.until(`document.querySelectorAll("#buttons button").length > 0 || document.getElementById("warn").textContent.length > 0`);
    const box = await h.evaluate(
      `(() => { document.body.style.display = "inline-block"; const r = document.body.getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`,
    );
    const shot = await h.page.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: box.width, height: box.height, scale: 2 },
    });
    writeFileSync(args.out, Buffer.from(shot.data, "base64"));
    console.log(`title: ${title || "(none)"}`);
    for (const [n, label] of labels.entries()) console.log(`  ${label}  →  ${opens[n]}`);
    if (warn) console.log(`note: ${warn}`);
    console.log(`picture: ${resolve(args.out)} (${box.width}×${box.height})`);
    return labels.length && !/could not be used/.test(warn) ? 0 : 1;
  } catch (e) {
    console.error(`✗ could not look: ${e.message}`);
    return 2;
  } finally {
    await h.stop();
  }
}

process.exit(await main());
