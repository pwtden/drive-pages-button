// The real-Chrome plumbing both scripts share: serve the extension's own files, start a headless Chrome, talk to one of
// its pages over the DevTools protocol, and open an extension page with the Chrome APIs it uses stood in for.
//
// Branded Google Chrome no longer loads an unpacked extension from the command line, so the extension's files are
// served as they are and chrome.tabs, chrome.storage (managed and sync) and chrome.runtime.openOptionsPage are stubs.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { js: "text/javascript", html: "text/html", json: "application/json", png: "image/png" };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One CDP connection to one page: send a command, await its answer. */
export function connect(wsUrl) {
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

/**
 * Serve `dir` on 127.0.0.1, start headless Chrome with a throwaway profile, and connect to a blank page. Returns the
 * page with `evaluate`, `until` and `open` (an extension page with the Chrome APIs stood in for), and `stop`, which
 * closes Chrome, the server and the profile. Throws when Chrome does not start.
 */
export async function startChrome(dir, chromePath = DEFAULT_CHROME) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const name = new URL(req.url).pathname.slice(1);
      if (!/^[\w./-]+$/.test(name) || name.includes("..")) return new Response("no", { status: 404 });
      const f = Bun.file(join(dir, name));
      if (!(await f.exists())) return new Response("no", { status: 404 });
      return new Response(f, { headers: { "content-type": TYPES[name.split(".").pop()] ?? "application/octet-stream" } });
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "drive-pages-button-"));
  const chrome = Bun.spawn(
    [
      chromePath,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const stop = async () => {
    chrome.kill();
    await chrome.exited;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  };
  let port;
  for (let i = 0; i < 100 && !port; i += 1) {
    try {
      port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
    } catch {
      await sleep(100);
    }
  }
  if (!port) {
    await stop();
    throw new Error("Chrome did not start (no DevToolsActivePort)");
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const evaluate = async (expression) =>
    (await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  /** Wait up to 10 s for `expression` to be truthy; false when it never is. */
  const until = async (expression) => {
    for (let i = 0; i < 100; i += 1) {
      if (await evaluate(expression)) return true;
      await sleep(100);
    }
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
    await until(`document.readyState === "complete"`);
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  };
  return { page, evaluate, until, open, stop };
}
