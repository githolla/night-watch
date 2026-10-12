import assert from "node:assert/strict";
import test from "node:test";
import { appBase } from "./app-url.ts";

test("email links use APP_URL cleaned up, or the request's own address", () => {
  const request = new Request("https://night-watch-abc123.vercel.app/api/cron/evening");
  const saved = process.env.APP_URL;
  try {
    process.env.APP_URL = " https://night-watch-snowy.vercel.app/\n";
    assert.equal(appBase(request), "https://night-watch-snowy.vercel.app");
    process.env.APP_URL = "https://night-watch-snowy.vercel.app/login";
    assert.equal(appBase(request), "https://night-watch-snowy.vercel.app");
    process.env.APP_URL = "night-watch-snowy";
    assert.equal(appBase(request), "https://night-watch-abc123.vercel.app");
    delete process.env.APP_URL;
    assert.equal(appBase(request), "https://night-watch-abc123.vercel.app");
  } finally {
    if (saved === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved;
  }
});
