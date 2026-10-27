(function bootOptions() {
  "use strict";

  const core = globalThis.RuliwebBestTab;
  const chromeApi = globalThis.chrome;

  if (!core || !chromeApi?.storage?.local) {
    return;
  }

  const form = {
    showBoardLabels: document.querySelector("#show-board-labels"),
    detailFetchDelayMs: document.querySelector("#detail-fetch-delay-ms"),
    maxDetailFetchesPerPage: document.querySelector("#max-detail-fetches-per-page"),
    hiddenBoards: document.querySelector("#hidden-boards"),
    hiddenBoardTabs: document.querySelector("#hidden-board-tabs"),
    hiddenKeywords: document.querySelector("#hidden-keywords"),
    exportFilters: document.querySelector("#export-filters"),
    importFilters: document.querySelector("#import-filters"),
    filterFile: document.querySelector("#filter-file"),
    save: document.querySelector("#save"),
    reset: document.querySelector("#reset"),
    status: document.querySelector("#status")
  };

  function storageGet(keys) {
    return core.storageGet(chromeApi, keys);
  }

  function storageSet(value) {
    return core.storageSet(chromeApi, value);
  }

  function boardMapToText(hiddenBoards) {
    return Object.entries(hiddenBoards || {})
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([id, name]) => `${id}|${name}`)
      .join("\n");
  }

  function keywordMapToText(hiddenKeywords) {
    return Object.values(hiddenKeywords || {})
      .sort((a, b) => a.localeCompare(b, "ko"))
      .join("\n");
  }

  function boardTabMapToText(hiddenBoardTabs) {
    return Object.entries(hiddenBoardTabs || {})
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([key, label]) => `${key}|${label || key}`)
      .join("\n");
  }

  function parseBoardText(value) {
    return Object.fromEntries(
      String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [id, ...nameParts] = line.split("|");
          const boardId = id.trim();
          const boardName = nameParts.join("|").trim() || `board ${boardId}`;
          return [boardId, boardName];
        })
        .filter(([boardId]) => /^\d+$/.test(boardId))
    );
  }

  function parseBoardTabText(value) {
    const entries = String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [first, second, ...rest] = line.split("|").map((part) => part.trim());
        let key = "";
        let label = "";

        if (first.includes("::")) {
          const [boardId, rawTab] = first.split("::");
          const tab = core.normalizeLabel(rawTab);
          key = core.makeBoardTabKey(boardId, tab);
          label = [second, ...rest].filter(Boolean).join("|") || (key ? `${boardId} / ${tab}` : "");
        } else {
          const tab = core.normalizeLabel(second);
          const boardName = rest.filter(Boolean).join("|");
          key = core.makeBoardTabKey(first, tab);
          label = boardName ? `${boardName} / ${tab}` : (key ? `${first} / ${tab}` : "");
        }

        return [key, label];
      })
      .filter(([key]) => key);

    return Object.fromEntries(entries);
  }

  function parseKeywordText(value) {
    return Object.fromEntries(
      String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((keyword) => [core.normalizeHeaderKeyword(keyword), core.normalizeHeaderKeyword(keyword)])
        .filter(([keyword]) => keyword)
    );
  }

  function readFormSettings() {
    return core.mergeSettings({
      showBoardLabels: form.showBoardLabels.checked,
      detailFetchDelayMs: form.detailFetchDelayMs.value,
      maxDetailFetchesPerPage: form.maxDetailFetchesPerPage.value,
      hiddenBoards: parseBoardText(form.hiddenBoards.value),
      hiddenBoardTabs: parseBoardTabText(form.hiddenBoardTabs.value),
      hiddenKeywords: parseKeywordText(form.hiddenKeywords.value)
    });
  }

  function setStatus(text, persistent = false) {
    form.status.textContent = text;
    if (persistent) {
      return;
    }
    setTimeout(() => {
      if (form.status.textContent === text) {
        form.status.textContent = "";
      }
    }, 1600);
  }

  function render(settings) {
    form.showBoardLabels.checked = settings.showBoardLabels;
    form.detailFetchDelayMs.value = String(settings.detailFetchDelayMs);
    form.maxDetailFetchesPerPage.value = String(settings.maxDetailFetchesPerPage);
    form.hiddenBoards.value = boardMapToText(settings.hiddenBoards);
    form.hiddenBoardTabs.value = boardTabMapToText(settings.hiddenBoardTabs);
    form.hiddenKeywords.value = keywordMapToText(settings.hiddenKeywords);
  }

  async function load() {
    try {
      const stored = await storageGet([core.SETTINGS_KEY]);
      render(core.mergeSettings(stored[core.SETTINGS_KEY]));
    } catch (error) {
      [form.save, form.reset, form.importFilters, form.exportFilters].forEach((control) => {
        control.disabled = true;
      });
      setStatus("설정을 불러오지 못했습니다", true);
    }
  }

  async function save() {
    const settings = readFormSettings();

    try {
      await storageSet({ [core.SETTINGS_KEY]: settings });
      render(settings);
      setStatus("저장됨");
    } catch (error) {
      setStatus("저장 실패");
    }
  }

  function exportFilters() {
    const settings = readFormSettings();
    const documentText = `${JSON.stringify(core.createFilterDocument(settings), null, 2)}\n`;
    const blob = new Blob([documentText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `ㄹㄹ필터-${date}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus("내보냄");
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(reader.error || new Error("파일 읽기 실패")));
      reader.readAsText(file, "utf-8");
    });
  }

  async function importFilters(file) {
    if (!file) {
      return;
    }

    try {
      const text = await readTextFile(file);
      const settings = core.applyFilterDocument(readFormSettings(), text);
      await storageSet({ [core.SETTINGS_KEY]: settings });
      render(settings);
      setStatus("가져옴");
    } catch (error) {
      setStatus("가져오기 실패");
    } finally {
      form.filterFile.value = "";
    }
  }

  async function reset() {
    const settings = core.mergeSettings();
    try {
      await storageSet({ [core.SETTINGS_KEY]: settings });
      render(settings);
      setStatus("초기화됨");
    } catch (error) {
      setStatus("초기화 실패");
    }
  }

  form.save.addEventListener("click", save);
  form.reset.addEventListener("click", reset);
  form.exportFilters.addEventListener("click", exportFilters);
  form.importFilters.addEventListener("click", () => form.filterFile.click());
  form.filterFile.addEventListener("change", () => importFilters(form.filterFile.files?.[0]));
  load();
})();
