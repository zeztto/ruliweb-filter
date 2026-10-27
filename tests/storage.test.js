const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../src/core.js");

function failingChrome() {
  const chromeApi = { runtime: {}, storage: { local: {} } };
  chromeApi.storage.local.get = (_keys, callback) => {
    chromeApi.runtime.lastError = { message: "Storage read failed" };
    callback(undefined);
    delete chromeApi.runtime.lastError;
  };
  chromeApi.storage.local.set = (_value, callback) => {
    chromeApi.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
    callback();
    delete chromeApi.runtime.lastError;
  };
  return chromeApi;
}

test("storage read rejects callback lastError instead of using empty defaults", async () => {
  await assert.rejects(core.storageGet(failingChrome(), [core.SETTINGS_KEY]), /Storage read failed/);
});

test("storage write rejects callback quota errors", async () => {
  await assert.rejects(core.storageSet(failingChrome(), { [core.SETTINGS_KEY]: {} }), /quota exceeded/);
});

async function optionsHarness({ failRead = false } = {}) {
  const selectors = ["show-board-labels", "detail-fetch-delay-ms", "max-detail-fetches-per-page", "hidden-boards", "hidden-board-tabs", "hidden-keywords", "export-filters", "import-filters", "filter-file", "save", "reset", "status"];
  const elements = Object.fromEntries(selectors.map((id) => [`#${id}`, {
    value: "", checked: false, disabled: false, textContent: "", listeners: {},
    addEventListener(event, listener) { this.listeners[event] = listener; }
  }]));
  const chromeApi = failingChrome();
  const original = core.mergeSettings({ hiddenBoards: { 300143: "저장된 게시판" } });
  if (!failRead) chromeApi.storage.local.get = (_keys, callback) => callback({ [core.SETTINGS_KEY]: original });
  vm.runInNewContext(fs.readFileSync(require.resolve("../options/options.js"), "utf8"), {
    RuliwebBestTab: core, chrome: chromeApi,
    document: { querySelector: (selector) => elements[selector] },
    setTimeout() {},
  });
  await new Promise(setImmediate);
  return { elements, original };
}

test("options failed save and reset show failure and retain form filters", async () => {
  const { elements } = await optionsHarness();
  await elements["#save"].listeners.click();
  assert.equal(elements["#status"].textContent, "저장 실패");
  assert.equal(elements["#hidden-boards"].value, "300143|저장된 게시판");
  await elements["#reset"].listeners.click();
  assert.equal(elements["#status"].textContent, "초기화 실패");
  assert.equal(elements["#hidden-boards"].value, "300143|저장된 게시판");
});

test("options failed read disables changes instead of overwriting unread settings", async () => {
  const { elements } = await optionsHarness({ failRead: true });
  assert.equal(elements["#status"].textContent, "설정을 불러오지 못했습니다");
  for (const selector of ["#save", "#reset", "#import-filters", "#export-filters"]) {
    assert.equal(elements[selector].disabled, true);
  }
});
