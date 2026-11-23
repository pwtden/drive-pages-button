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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } },
  strict: true,
});
const DIR = resolve(import.meta.dir, "../extension");
const EXAMPLE = JSON.parse(readFileSync(resolve(import.meta.dir, "../examples/example-config.json"), "utf8"));
const FOLDER = "1MADEUPFOLDERID0000";
const FILE = "1MADEUPDOCUMENTID000";
const TYPES = { js: "text/javascript", html: "text/html", json: "application/json", png: "image/png" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One CDP connection to one page: send a command, await its answer. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(String(m.data));
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message));
    else w.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      id += 1;
      waiting.set(id, { resolve: resolveSend, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((ok, fail) => {
    ws.addEventListener("open", () => ok({ send, close: () => ws.close() }));
    ws.addEventListener("error", () => fail(new Error("could not connect to Chrome")));
  });
}

async function main() {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const name = new URL(req.url).pathname.slice(1);
      if (!/^[\w./-]+$/.test(name) || name.includes("..")) return new Response("no", { status: 404 });
      const f = Bun.file(join(DIR, name));
      if (!(await f.exists())) return new Response("no", { status: 404 });
      return new Response(f, { headers: { "content-type": TYPES[name.split(".").pop()] ?? "application/octet-stream" } });
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "drive-pages-button-"));
  const chrome = Bun.spawn(
    [
      args.chrome,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const failures = [];
  const check = (ok, what) => {
    console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
    if (!ok) failures.push(what);
  };
  try {
    let port;
    for (let i = 0; i < 100 && !port; i += 1) {
      try {
        port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
      } catch {
        await sleep(100);
      }
    }
    if (!port) {
      console.error("✗ could not look: Chrome did not start (no DevToolsActivePort)");
      return 2;
    }
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const evaluate = async (expression) =>
      (await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
    const until = async (expression, what) => {
      for (let i = 0; i < 100; i += 1) {
        if (await evaluate(expression)) return true;
        await sleep(100);
      }
      check(false, `timed out waiting for ${what}`);
      return false;
    };

    /** Open one of the extension's pages with the Chrome APIs stood in for. */
    const open = async (file, { tab, managed = {}, own } = {}) => {
      const stub = `window.__opened = []; window.__saved = []; window.__options = 0; window.close = () => { window.__closed = true; };
        window.chrome = {
          tabs: { query: async () => [{ url: ${JSON.stringify(tab ?? "about:blank")} }], create: async (o) => { window.__opened.push(o.url); } },
          storage: {
            managed: { get: async () => (${JSON.stringify(managed)}) },
            sync: { get: async () => (${JSON.stringify(own === undefined ? {} : { config: own })}), set: async (o) => { window.__saved.push(o); } },
          },
          runtime: { openOptionsPage: () => { window.__options += 1; } },
        };`;
      const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
      await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/${file}` });
      await sleep(150);
      await until(`document.readyState === "complete"`, `${file} to load`);
      await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    };
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
    chrome.kill();
    await chrome.exited;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures.length ? `✗ ${failures.length} check(s) failed` : "✓ every check passed in real Chrome");
  return failures.length ? 1 : 0;
}

process.exit(await main());
