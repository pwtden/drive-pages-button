import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFlags, compareVersions, Exit, maskNames, plan, resolveSettings, summarize, zipVersion } from "./web-store.js";

const ids = { publisher: "pub-1", item: "abcdefghijklmnop", "service-account": "robot@project.iam.gserviceaccount.com" };

describe("resolveSettings", () => {
  test("a flag wins over its environment variable", () => {
    const s = resolveSettings({ ...ids, account: "flag@example.com" }, { CWS_GCLOUD_ACCOUNT: "env@example.com", CWS_PUBLISHER_ID: "env" });
    expect(s).toEqual({
      publisher: "pub-1",
      item: "abcdefghijklmnop",
      serviceAccount: ids["service-account"],
      account: "flag@example.com",
    });
  });

  test("everything can come from the environment, and the gcloud account is optional", () => {
    const env = { CWS_PUBLISHER_ID: "p", CWS_ITEM_ID: "i", CWS_SERVICE_ACCOUNT: "sa@x.iam.gserviceaccount.com" };
    expect(resolveSettings({}, env)).toEqual({ publisher: "p", item: "i", serviceAccount: "sa@x.iam.gserviceaccount.com", account: "" });
  });

  test("names every missing setting, exit 2", () => {
    let error;
    try {
      resolveSettings({ item: "i" }, {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Exit);
    expect(error.code).toBe(2);
    expect(error.message).toContain("CWS_PUBLISHER_ID");
    expect(error.message).toContain("CWS_SERVICE_ACCOUNT");
    expect(error.message).not.toContain("CWS_ITEM_ID");
  });

  test("refuses an id that would change the address", () => {
    expect(() => resolveSettings({ ...ids, item: "x/../../other" }, {})).toThrow("item is not an id");
    expect(() => resolveSettings({ ...ids, publisher: "p?q=1" }, {})).toThrow("publisher is not an id");
  });
});

test("compareVersions orders Chrome versions by number, not text", () => {
  expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
  expect(compareVersions("2.1", "2.1.0")).toBe(0);
  expect(compareVersions("2.0.0", "2.1.0")).toBe(-1);
});

const status = {
  itemId: "abcdefghijklmnop",
  publicKey: "-----BEGIN PUBLIC KEY-----",
  publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ deployPercentage: 100, crxVersion: "2.0.0" }] },
  submittedItemRevisionStatus: { state: "PENDING_REVIEW", distributionChannels: [{ deployPercentage: 100, crxVersion: "2.1.0" }] },
};

test("summarize keeps the versions and states and drops the public key", () => {
  expect(summarize(status)).toEqual({
    item: "abcdefghijklmnop",
    published: { state: "PUBLISHED", versions: ["2.0.0"] },
    submitted: { state: "PENDING_REVIEW", versions: ["2.1.0"] },
    lastUpload: null,
    warned: false,
    takenDown: false,
  });
  expect(summarize({ itemId: "x" }).published).toBeNull();
});

describe("plan", () => {
  const s = summarize(status);
  test("a version already in review is not uploaded again", () => expect(plan(s, "2.1.0").action).toBe("skip"));
  test("the published version is not uploaded again", () => expect(plan(s, "2.0.0").action).toBe("skip"));
  test("a version below the published one is refused", () => expect(plan(s, "1.9.9").action).toBe("refuse"));
  test("a newer version is uploaded", () =>
    expect(plan(s, "2.2.0")).toEqual({ action: "upload", why: "2.2.0 replaces the published 2.0.0" }));
  test("a rejected submission of the same version may be uploaded again", () => {
    const rejected = summarize({ ...status, submittedItemRevisionStatus: { ...status.submittedItemRevisionStatus, state: "REJECTED" } });
    expect(plan(rejected, "2.1.0").action).toBe("upload");
  });
  test("an item never published takes its first version", () => expect(plan(summarize({ itemId: "x" }), "1.0.0").action).toBe("upload"));
});

describe("zipVersion", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-store-test-"));
  const zipOf = (name, manifest) => {
    writeFileSync(join(dir, "manifest.json"), manifest);
    const zip = join(dir, name);
    const r = Bun.spawnSync(["zip", "-q", "-j", zip, join(dir, "manifest.json")]);
    if (r.exitCode !== 0) throw new Error("zip failed");
    return zip;
  };
  test("reads the manifest's version", () => expect(zipVersion(zipOf("good.zip", '{"version":"2.1.0"}'))).toBe("2.1.0"));
  test("refuses a manifest without a usable version", () =>
    expect(() => zipVersion(zipOf("bad.zip", '{"version":"v2"}'))).toThrow("no usable version"));
  test("refuses a file that is not a zip", () => {
    writeFileSync(join(dir, "not.zip"), "plain text");
    expect(() => zipVersion(join(dir, "not.zip"))).toThrow("no readable manifest.json");
  });
});

test("the script names no publisher, account or item (the repository is public)", () => {
  const source = readFileSync(join(import.meta.dir, "web-store.js"), "utf8");
  expect(source).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]+/);
  expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  expect(source).not.toMatch(/\b[a-p]{32}\b/);
});

describe("checkFlags", () => {
  test("a command refuses the other command's flags", () => {
    expect(() => checkFlags("status", { "dry-run": true, zip: "f.zip" })).toThrow("status does not take --zip, --dry-run");
    expect(() => checkFlags("status", { staged: true })).toThrow("status does not take --staged");
    expect(() => checkFlags("release", { published: "2.1.0" })).toThrow("release does not take --published");
  });
  test("an empty value is refused instead of turning its check off", () => {
    expect(() => checkFlags("status", { published: "" })).toThrow("--published is empty");
    expect(() => checkFlags("release", { zip: "f.zip", sha256: " " })).toThrow("--sha256 is empty");
  });
  test("each command takes its own flags", () => {
    expect(() => checkFlags("status", { published: "2.1.0", raw: true })).not.toThrow();
    expect(() => checkFlags("release", { zip: "f.zip", sha256: "ab", "wait-linked": "5", staged: true, "dry-run": true })).not.toThrow();
  });
});

test("maskNames hides the service account and the login in gcloud's errors", () => {
  const line = "ERROR: Error 403 (Forbidden) - failed to impersonate [robot@project.iam.gserviceaccount.com]. Login: me@example.com";
  expect(maskNames(line)).toBe("ERROR: Error 403 (Forbidden) - failed to impersonate […]. Login: <account>");
  expect(maskNames("Your current active account [me@example.com] does not have any valid credentials")).not.toContain("example");
});
