#!/usr/bin/env bun
// web-store: publish this extension to the Chrome Web Store through its API (v2), as a service account that has no key.
// gcloud mints each token by impersonation, from a login that holds Token Creator on the service account, so nothing
// secret is stored anywhere. Nothing about any one publisher is in this file: every id and account comes from a flag or
// an environment variable.
//
//   bun scripts/web-store.js status  [--published <version>] [--raw]
//   bun scripts/web-store.js release --zip <file> [--sha256 <hex>] [--wait-linked <minutes>] [--staged] [--dry-run]
//
//   status   what the store holds: the published version and state, and the one submitted for review
//            --published <v>  exit 0 only when version v is published (state PUBLISHED), 4 while it is not yet
//            --raw            print the API's answer as it is
//   release  check the zip, upload it, wait until the store has processed it, and submit it for review. Does nothing
//            when the zip's version is already submitted or published, and refuses a version not above the published one
//            --sha256 <hex>        refuse a zip whose SHA-256 differs (from scripts/package.sh or the GitHub release)
//            --wait-linked <min>   wait up to this long for the service account to be able to read the item (just after
//                                  it was linked in the Developer Dashboard); default 0, ask once
//            --staged              on approval, hold the version for you to publish instead of publishing it at once
//            --dry-run             check and print the plan; upload and submit nothing
//   A flag the other command takes, or an empty value, is refused (exit 2). There is no separate submit: when an upload
//   succeeded but its submission did not, run release again (the version is neither submitted nor published yet).
//
//   --publisher        or CWS_PUBLISHER_ID     the publisher id (Developer Dashboard › Account)
//   --item             or CWS_ITEM_ID          the item id, the extension's id in the store
//   --service-account  or CWS_SERVICE_ACCOUNT  the service account added in Developer Dashboard › Settings › Service account
//   --account          or CWS_GCLOUD_ACCOUNT   the gcloud login that holds Token Creator on it (default: gcloud's active one)
//
// One JSON line per step on stdout; a token is never printed.
// Exit 0 done · 1 the store refused, or the upload failed · 2 usage, a bad zip, or no token · 3 the item cannot be read
// (not linked yet, or a wrong id) · 4 status --published: that version is not the published one yet.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const API = "https://chromewebstore.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

export class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The four settings, each from its flag or else its environment variable. Throws Exit 2 naming whatever is missing. */
export function resolveSettings(values, env) {
  const pick = (flag, name) => (values[flag] ?? env[name] ?? "").trim();
  const settings = {
    publisher: pick("publisher", "CWS_PUBLISHER_ID"),
    item: pick("item", "CWS_ITEM_ID"),
    serviceAccount: pick("service-account", "CWS_SERVICE_ACCOUNT"),
    account: pick("account", "CWS_GCLOUD_ACCOUNT"),
  };
  const missing = [
    ["publisher", "--publisher or CWS_PUBLISHER_ID"],
    ["item", "--item or CWS_ITEM_ID"],
    ["serviceAccount", "--service-account or CWS_SERVICE_ACCOUNT"],
  ]
    .filter(([key]) => !settings[key])
    .map(([, how]) => how);
  if (missing.length) throw new Exit(2, `missing: ${missing.join(", ")}`);
  for (const key of ["publisher", "item"]) {
    if (!/^[A-Za-z0-9-]+$/.test(settings[key])) throw new Exit(2, `${key} is not an id: ${settings[key]}`);
  }
  return settings;
}

/** -1, 0 or 1, comparing Chrome extension versions (up to four dot-separated integers). */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const ENDED = ["REJECTED", "CANCELLED"];
const revision = (r) => (r ? { state: r.state ?? null, versions: (r.distributionChannels ?? []).map((c) => c.crxVersion) } : null);

/** The parts of a fetchStatus answer that matter, without the public key. */
export function summarize(status) {
  return {
    item: status.itemId ?? null,
    published: revision(status.publishedItemRevisionStatus),
    submitted: revision(status.submittedItemRevisionStatus),
    lastUpload: status.lastAsyncUploadState ?? null,
    warned: Boolean(status.warned),
    takenDown: Boolean(status.takenDown),
  };
}

/**
 * What release should do with a zip of `version`, given the store's summary: "skip" when it is already submitted (and
 * not rejected or cancelled) or published, "refuse" when it is not above the published version, else "upload".
 */
export function plan(summary, version) {
  const has = (r) => Boolean(r?.versions.includes(version));
  if (has(summary.published)) return { action: "skip", why: `${version} is already published` };
  if (has(summary.submitted) && !ENDED.includes(summary.submitted.state)) {
    return { action: "skip", why: `${version} is already submitted (${summary.submitted.state})` };
  }
  const newest = summary.published?.versions?.[0];
  if (newest && compareVersions(version, newest) <= 0) {
    return { action: "refuse", why: `${version} is not above the published ${newest}` };
  }
  return { action: "upload", why: newest ? `${version} replaces the published ${newest}` : `${version} is the first version` };
}

const RELEASE_ONLY = ["zip", "sha256", "wait-linked", "dry-run"];
const STATUS_ONLY = ["published", "raw"];

/**
 * Refuses a flag the command does not use and an empty value, which would turn its check off (an unset shell variable
 * in `--published "$V"` or `--sha256 "$H"`). Throws Exit 2.
 */
export function checkFlags(command, values) {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && !value.trim()) throw new Exit(2, `--${key} is empty`);
  }
  const notHere = command === "release" ? STATUS_ONLY : [...RELEASE_ONLY, "staged"];
  const stray = notHere.filter((key) => values[key] !== undefined && values[key] !== false);
  if (stray.length) throw new Exit(2, `${command} does not take ${stray.map((key) => `--${key}`).join(", ")}`);
}

/** gcloud's error lines name the service account and the login, in brackets or bare: masks both, since such a line may be pasted in public. */
export function maskNames(line) {
  return line.replace(/\[[^\]]*\]/g, "[…]").replace(/[\w.+-]+@[\w.-]+/g, "<account>");
}

/** The manifest's version inside a zip, read with unzip. */
export function zipVersion(zip) {
  const r = Bun.spawnSync(["unzip", "-p", zip, "manifest.json"], { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  if (r.exitCode !== 0) throw new Exit(2, `${zip} has no readable manifest.json (unzip exit ${r.exitCode})`);
  let manifest;
  try {
    manifest = JSON.parse(r.stdout.toString());
  } catch {
    throw new Exit(2, `${zip}: manifest.json is not JSON`);
  }
  if (typeof manifest.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    throw new Exit(2, `${zip}: manifest.json has no usable version`);
  }
  return manifest.version;
}

function token(settings) {
  const argv = ["gcloud", "auth", "print-access-token", "--impersonate-service-account", settings.serviceAccount, "--scopes", SCOPE];
  if (settings.account) argv.push("--account", settings.account);
  let r;
  try {
    r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 90_000 });
  } catch (e) {
    throw new Exit(2, `no token: could not run gcloud (${e.message})`);
  }
  const tok = r.stdout.toString().trim();
  if (r.exitCode !== 0 || !tok) {
    const why = r.stderr
      .toString()
      .split("\n")
      .filter((l) => l.trim() && !/impersonation/i.test(l))
      .slice(-2)
      .map(maskNames)
      .join(" ");
    throw new Exit(2, `no token: gcloud exit ${r.exitCode}${why ? `: ${why}` : ""}`);
  }
  return tok;
}

function makeClient(settings) {
  const tok = token(settings);
  const name = `publishers/${settings.publisher}/items/${settings.item}`;
  const call = async (method, path, { body, type, timeout = 60_000 } = {}) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(type ? { "Content-Type": type } : {}) },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: { code: res.status, message: text.slice(0, 200) } };
    }
    if (!res.ok || data.error) {
      const code = data.error?.code ?? res.status;
      return { error: { code, status: data.error?.status ?? null, message: data.error?.message ?? res.statusText } };
    }
    return data;
  };
  return {
    status: () => call("GET", `/v2/${name}:fetchStatus`),
    upload: (bytes) => call("POST", `/upload/v2/${name}:upload`, { body: bytes, type: "application/zip", timeout: 300_000 }),
    submit: (staged) =>
      call("POST", `/v2/${name}:publish`, {
        body: JSON.stringify(staged ? { publishType: "STAGED_PUBLISH" } : {}),
        type: "application/json",
      }),
  };
}

const say = (step, fields) => console.log(JSON.stringify({ step, ...fields }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetchStatus, waiting up to `minutes` while the item cannot be read (403 or 404 just after the service account was linked). */
async function readableStatus(client, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const s = await client.status();
    if (!s.error) return s;
    const notYet = [403, 404].includes(s.error.code);
    if (!notYet) throw new Exit(1, `the store refused fetchStatus: ${s.error.code} ${s.error.message}`);
    if (Date.now() >= deadline) {
      throw new Exit(
        3,
        `the service account cannot read the item (${s.error.code}): link it in Developer Dashboard › Settings › Service account, or check the ids`,
      );
    }
    say("wait-linked", { code: s.error.code });
    await sleep(30_000);
  }
}

async function submitAndReport(client, staged) {
  const p = await client.submit(staged);
  if (p.error) throw new Exit(1, `the store refused the submission: ${p.error.code} ${p.error.message}`);
  say("submit", { state: p.state ?? null, ...(p.warningInfo ? { warnings: p.warningInfo } : {}) });
  if (ENDED.includes(p.state)) throw new Exit(1, `the submission is ${p.state}`);
  const after = await client.status();
  if (!after.error) say("status", summarize(after));
}

async function release(settings, values) {
  if (!values.zip) throw new Exit(2, "release needs --zip <file>");
  let bytes;
  try {
    bytes = readFileSync(values.zip);
  } catch (e) {
    throw new Exit(2, `cannot read ${values.zip}: ${e.code ?? e.message}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (values.sha256 !== undefined && values.sha256.trim().toLowerCase() !== sha256) {
    throw new Exit(2, `SHA-256 differs: the zip is ${sha256}, --sha256 says ${values.sha256}`);
  }
  const version = zipVersion(values.zip);
  say("zip", { file: values.zip, version, sha256, bytes: bytes.length, checked: values.sha256 !== undefined });

  const waitMinutes = Number(values["wait-linked"] ?? 0);
  if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new Exit(2, "--wait-linked takes a number of minutes");
  const client = makeClient(settings);
  const before = summarize(await readableStatus(client, waitMinutes));
  say("status", before);
  const decided = plan(before, version);
  say("plan", decided);
  if (decided.action === "skip") return 0;
  if (decided.action === "refuse") throw new Exit(2, decided.why);
  if (values["dry-run"]) return 0;

  const u = await client.upload(bytes);
  if (u.error) throw new Exit(1, `the store refused the upload: ${u.error.code} ${u.error.message}`);
  let state = u.uploadState;
  say("upload", { state, version: u.crxVersion ?? null });
  for (let i = 0; state === "IN_PROGRESS" && i < 40; i += 1) {
    await sleep(15_000);
    const s = await client.status();
    state = s.error ? "IN_PROGRESS" : s.lastAsyncUploadState;
    say("upload", { state });
  }
  if (state !== "SUCCEEDED") throw new Exit(1, `the upload did not succeed (${state}); nothing submitted`);
  if (u.crxVersion && u.crxVersion !== version) {
    throw new Exit(1, `the store read version ${u.crxVersion} from the upload, not ${version}; nothing submitted`);
  }
  await submitAndReport(client, Boolean(values.staged));
  return 0;
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      publisher: { type: "string" },
      item: { type: "string" },
      "service-account": { type: "string" },
      account: { type: "string" },
      published: { type: "string" },
      raw: { type: "boolean" },
      zip: { type: "string" },
      sha256: { type: "string" },
      "wait-linked": { type: "string" },
      staged: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (!["status", "release"].includes(command) || positionals.length > 1) {
    throw new Exit(2, "usage: bun scripts/web-store.js status|release [flags]; the flags are listed at the top of this file");
  }
  checkFlags(command, values);
  const settings = resolveSettings(values, process.env);
  if (command === "release") return release(settings, values);

  const client = makeClient(settings);
  const s = await readableStatus(client, 0);
  if (values.raw) console.log(JSON.stringify(s, null, 2));
  const summary = summarize(s);
  say("status", summary);
  if (values.published === undefined) return 0;
  const live = summary.published?.state === "PUBLISHED" && summary.published.versions.includes(values.published.trim());
  return live ? 0 : 4;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    const code = e instanceof Exit ? e.code : 2;
    console.error(`✗ ${e.message}`);
    process.exitCode = code;
  }
}
