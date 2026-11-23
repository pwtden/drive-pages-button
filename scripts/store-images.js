#!/usr/bin/env bun
// store-images: render the Chrome Web Store listing images from the real popup, in headless Chrome.
//   store/screenshot-1.png   1280x800  the popup on a Drive folder, with the example configuration
//   store/promo-small.png     440x280  the icon, the name and one line
// The popup runs with its Chrome APIs stood in for, exactly as in verify-in-real-chrome.js.
//
//   bun scripts/store-images.js [--chrome <path>]   # exit 0 written · 2 could not render
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } },
  strict: true,
});
const ROOT = resolve(import.meta.dir, "..");
const EXT = join(ROOT, "extension");
const OUT = join(ROOT, "store");
const EXAMPLE = readFileSync(join(ROOT, "examples", "example-config.json"), "utf8");
const FOLDER = "1MADEUPFOLDERID0000";
const TYPES = { js: "text/javascript", html: "text/html", json: "application/json", png: "image/png", svg: "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUB = `window.close = () => {}; window.chrome = {
  tabs: { query: async () => [{ url: "https://drive.google.com/drive/folders/${FOLDER}" }], create: async () => {} },
  storage: { managed: { get: async () => (${EXAMPLE}) }, sync: { get: async () => ({}), set: async () => {} } },
  runtime: { openOptionsPage: () => {} } };`;

const SCREENSHOT = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:800px;font-family:system-ui,sans-serif;background:#f1f3f4;display:flex;overflow:hidden}
.left{flex:1;padding:72px 56px;color:#1f1f1f}
.left img{width:72px;height:72px}
h1{font-size:44px;margin:20px 0 12px}
p{font-size:22px;line-height:1.45;color:#3c4043;margin:0 0 18px}
li{font-size:20px;line-height:1.5;color:#3c4043}
.right{width:470px;display:flex;align-items:flex-start;justify-content:center;padding-top:72px}
.popup{background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);overflow:hidden}
iframe{border:0;width:340px;height:196px;display:block}
</style></head><body>
<div class="left"><img src="/icons/icon-128.png" alt="">
<h1>Drive Pages Button</h1>
<p>Your organisation's own pages, one click from the Google Drive folder or file in front of you.</p>
<ul><li>Buttons set by your administrator through Chrome policy</li><li>No passwords, no data collected, no other sites read</li><li>Open source (MIT)</li></ul></div>
<div class="right"><div class="popup"><iframe src="/popup.html"></iframe></div></div>
</body></html>`;

const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:440px;height:280px;font-family:system-ui,sans-serif;background:linear-gradient(135deg,#e8f0fe,#fef7e0);display:flex;align-items:center;justify-content:center;overflow:hidden}
.box{text-align:center;color:#1f1f1f}
img{width:96px;height:96px}
h1{font-size:32px;margin:10px 0 6px}
p{font-size:16px;margin:0;color:#3c4043}
</style></head><body><div class="box"><img src="/icons/icon-128.png" alt=""><h1>Drive Pages Button</h1><p>Your organisation's pages, from Google Drive</p></div></body></html>`;

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
    new Promise((ok, fail) => {
      id += 1;
      waiting.set(id, { resolve: ok, reject: fail });
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
      if (name === "screenshot.html") return new Response(SCREENSHOT, { headers: { "content-type": "text/html" } });
      if (name === "promo.html") return new Response(PROMO, { headers: { "content-type": "text/html" } });
      if (!/^[\w./-]+$/.test(name) || name.includes("..")) return new Response("no", { status: 404 });
      const f = Bun.file(join(EXT, name));
      if (!(await f.exists())) return new Response("no", { status: 404 });
      return new Response(f, { headers: { "content-type": TYPES[name.split(".").pop()] ?? "application/octet-stream" } });
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "drive-pages-button-images-"));
  const chrome = Bun.spawn(
    [args.chrome, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  try {
    let port;
    for (let i = 0; i < 100 && !port; i += 1) {
      try {
        port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
      } catch {
        await sleep(100);
      }
    }
    if (!port) throw new Error("Chrome did not start");
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
    mkdirSync(OUT, { recursive: true });
    for (const [file, width, height, out] of [
      ["screenshot.html", 1280, 800, "screenshot-1.png"],
      ["promo.html", 440, 280, "promo-small.png"],
    ]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/${file}` });
      await sleep(1500);
      const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
      writeFileSync(join(OUT, out), Buffer.from(data, "base64"));
      console.log(`✓ store/${out} (${width}x${height})`);
    }
    page.close();
    return 0;
  } catch (e) {
    console.error(`✗ could not render: ${e.message}`);
    return 2;
  } finally {
    chrome.kill();
    await chrome.exited;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}

process.exit(await main());
