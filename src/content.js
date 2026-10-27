(function bootRuliwebBestTab() {
  "use strict";

  const core = globalThis.RuliwebBestTab;
  const chromeApi = globalThis.chrome;
  const STATUS_IDLE_DELAY_MS = 1200;
  const BOARD_LOOKUP_RETRY_DELAY_MS = 10 * 60 * 1000;

  if (!core || !chromeApi?.storage?.local) {
    return;
  }

  const state = {
    rows: [],
    settings: core.mergeSettings(),
    boardCache: {},
    boardNameById: new Map(),
    statusTimer: null,
    toolbar: null,
    statusNode: null,
    panelNode: null
  };

  function storageGet(keys) {
    return core.storageGet(chromeApi, keys);
  }

  function storageSet(value) {
    return core.storageSet(chromeApi, value);
  }

  function getBoardPageId() {
    if (location.pathname.includes("/read/")) {
      return "";
    }

    const hiddenBoardId = document.querySelector("#board_id")?.value?.trim();

    if (/^\d+$/.test(hiddenBoardId || "")) {
      return hiddenBoardId;
    }

    const match = location.pathname.match(/\/board\/(\d+)\/?$/);
    return match?.[1] || "";
  }

  function getListRoot() {
    const bestBody = document.querySelector("#best_body");

    if (bestBody) {
      return bestBody;
    }

    if (!getBoardPageId()) {
      return null;
    }

    return document.querySelector("#board_list");
  }

  function buildBoardNameMap() {
    const pageBoardId = getBoardPageId();
    const pageBoardName = core.cleanText(document.querySelector("#bbs_name")?.value || "");

    if (pageBoardId && pageBoardName) {
      state.boardNameById.set(pageBoardId, pageBoardName);
    }

    document.querySelectorAll("a[href*='/board/']").forEach((link) => {
      const article = core.parseArticleHref(link.getAttribute("href"), location.href);

      if (article) {
        return;
      }

      let url;

      try {
        url = new URL(link.getAttribute("href"), location.href);
      } catch (error) {
        return;
      }

      const match = url.pathname.match(/\/board\/(\d+)(?:\/)?$/);

      if (!match) {
        return;
      }

      const label = core.cleanText(link.getAttribute("title") || link.textContent);

      if (label) {
        state.boardNameById.set(match[1], label);
      }
    });
  }

  function getTitleText(link) {
    const titleNode = link.querySelector("strong.text_over, span.text_over");

    if (titleNode) {
      return core.cleanText(titleNode.textContent);
    }

    const clone = link.cloneNode(true);
    clone.querySelectorAll(".rbt-labels, .num_reply, i, input").forEach((node) => {
      node.remove();
    });

    return core.cleanText(link.getAttribute("title") || clone.textContent || link.textContent);
  }

  function createBadge(kind, label, title) {
    const badge = document.createElement("span");
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    badge.className = `rbt-badge rbt-badge-${kind}`;
    badge.textContent = label;
    badge.title = title;
    badge.dataset.rbtBadgeKind = kind;
    return badge;
  }

  function getDisplayBoardName(boardName) {
    return core.formatBoardDisplayName(boardName);
  }

  function onBadgeActivate(badge, callback) {
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback();
    });

    badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      callback();
    });
  }

  function insertBadgeWrap(row, link) {
    let wrap = link.querySelector(":scope > .rbt-labels");

    if (wrap) {
      return wrap;
    }

    wrap = document.createElement("span");
    wrap.className = "rbt-labels";
    link.prepend(wrap);

    row.dataset.rbtEnhanced = "true";
    return wrap;
  }

  function positionSoonBestMarker(row, link, wrap) {
    const marker = row.querySelector(".aaicon.soon_best");

    if (!marker) {
      return;
    }

    marker.classList.add("rbt-soon-best");

    if (marker.parentElement !== link || marker.previousElementSibling !== wrap) {
      wrap.after(marker);
    }
  }

  function setStatus(text, isBusy) {
    if (!state.statusNode) {
      return;
    }

    state.statusNode.textContent = text;
    state.statusNode.dataset.busy = String(Boolean(isBusy));

    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
    }

    if (!isBusy) {
      state.statusTimer = setTimeout(() => {
        if (state.statusNode) {
          state.statusNode.textContent = "대기";
        }
      }, STATUS_IDLE_DELAY_MS);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function collectRows() {
    const listRoot = getListRoot();

    if (!listRoot) {
      state.rows = [];
      return;
    }

    const pageBoardId = getBoardPageId();
    const rows = Array.from(listRoot.querySelectorAll("tr.table_body.blocktarget"));

    state.rows = rows
      .map((row) => {
        const link = row.querySelector("a.subject_link[href*='/read/']");
        const article = core.parseArticleHref(link?.getAttribute("href"), location.href);

        if (!link || !article) {
          return null;
        }

        const boardName = getKnownBoardName(article.boardId) || `board ${article.boardId}`;
        const category = article.boardId === pageBoardId
          ? core.normalizeLabel(row.querySelector("td.divsn")?.textContent || "")
          : "";
        const title = getTitleText(link);
        const meta = {
          ...article,
          boardName,
          category,
          title
        };

        row.dataset.rbtBoardId = meta.boardId;
        row.dataset.rbtArticleId = meta.articleId;
        row.dataset.rbtBoardName = meta.boardName;
        row.dataset.rbtCategory = meta.category;
        row.dataset.rbtTitle = meta.title;

        return {
          row,
          link,
          meta
        };
      })
      .filter(Boolean);
  }

  function getKnownBoardName(boardId) {
    const cached = state.boardCache[boardId];

    if (state.boardNameById.has(boardId)) {
      return state.boardNameById.get(boardId);
    }

    if (cached && Date.now() - Number(cached.savedAt || 0) < core.CACHE_TTL_MS) {
      return cached.boardName || "";
    }

    return "";
  }

  function renderRowLabels(item) {
    const wrap = insertBadgeWrap(item.row, item.link);
    wrap.replaceChildren();

    if (state.settings.showBoardLabels) {
      const displayBoardName = getDisplayBoardName(item.meta.boardName);
      const boardBadge = createBadge(
        "board",
        displayBoardName,
        `${item.meta.boardName} 숨기기`
      );
      onBadgeActivate(boardBadge, () => toggleBoard(item.meta.boardId, item.meta.boardName));
      wrap.append(boardBadge);
    }

    if (item.meta.category) {
      const categoryBadge = createBadge(
        "category",
        `[${item.meta.category}]`,
        `${item.meta.boardName} / [${item.meta.category}] 탭 숨기기`
      );
      onBadgeActivate(categoryBadge, () => (
        toggleBoardTab(item.meta.boardId, item.meta.category, item.meta.boardName)
      ));
      wrap.append(categoryBadge);
    }

    positionSoonBestMarker(item.row, item.link, wrap);
  }

  function applyFilters() {
    let hiddenCount = 0;

    state.rows.forEach((item) => {
      const isHidden = core.isRowHiddenBySettings(item.meta, state.settings);
      item.row.hidden = isHidden;
      item.row.classList.toggle("rbt-row-hidden", isHidden);

      if (isHidden) {
        hiddenCount += 1;
      }
    });

    renderToolbarPanel();

    if (hiddenCount > 0) {
      setStatus(`${hiddenCount}개 숨김`, false);
    }
  }

  async function saveSettings(settings) {
    const nextSettings = core.mergeSettings(settings);
    try {
      await storageSet({ [core.SETTINGS_KEY]: nextSettings });
    } catch (error) {
      setStatus("저장 실패 · 기존 필터 유지", false);
      return false;
    }
    state.settings = nextSettings;
    state.rows.forEach(renderRowLabels);
    applyFilters();
    return true;
  }

  async function toggleBoard(boardId, boardName) {
    const hiddenBoards = { ...state.settings.hiddenBoards };

    if (hiddenBoards[boardId]) {
      delete hiddenBoards[boardId];
    } else {
      hiddenBoards[boardId] = boardName || `board ${boardId}`;
    }

    await saveSettings({ ...state.settings, hiddenBoards });
  }

  function formatBoardTabLabel(boardId, tab, boardName) {
    const label = getDisplayBoardName(boardName || `board ${boardId}`);
    return `${label} / ${tab}`;
  }

  async function toggleBoardTab(boardId, tabValue, boardName) {
    const tab = core.normalizeLabel(tabValue);
    const key = core.makeBoardTabKey(boardId, tab);

    if (!key) {
      return;
    }

    const hiddenBoardTabs = { ...state.settings.hiddenBoardTabs };

    if (hiddenBoardTabs[key]) {
      delete hiddenBoardTabs[key];
    } else {
      hiddenBoardTabs[key] = formatBoardTabLabel(boardId, tab, boardName);
    }

    await saveSettings({ ...state.settings, hiddenBoardTabs });
  }

  async function toggleSetting(key) {
    await saveSettings({ ...state.settings, [key]: !state.settings[key] });
  }

  async function clearHiddenFilters() {
    const saved = await saveSettings({
      ...state.settings,
      hiddenBoards: {},
      hiddenBoardTabs: {},
      hiddenKeywords: {}
    });
    if (saved) {
      setStatus("필터 해제", false);
    }
  }

  function getVisibleSources() {
    const boards = new Map();
    const boardTabs = new Map();

    state.rows.forEach((item) => {
      boards.set(item.meta.boardId, item.meta.boardName);

      if (item.meta.category) {
        const key = core.makeBoardTabKey(item.meta.boardId, item.meta.category);
        boardTabs.set(key, {
          boardId: item.meta.boardId,
          boardName: item.meta.boardName,
          tab: item.meta.category
        });
      }
    });

    return {
      boards: Array.from(boards.entries()).sort((a, b) => a[1].localeCompare(b[1], "ko")),
      boardTabs: Array.from(boardTabs.entries()).sort((a, b) => (
        formatBoardTabLabel(a[1].boardId, a[1].tab, a[1].boardName)
          .localeCompare(formatBoardTabLabel(b[1].boardId, b[1].tab, b[1].boardName), "ko")
      ))
    };
  }

  function createSourceButton(kind, key, label, isHidden, payload = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rbt-source-button";
    button.dataset.active = String(Boolean(isHidden));
    button.textContent = isHidden ? `${label} 숨김` : label;
    button.addEventListener("click", () => {
      if (kind === "board") {
        toggleBoard(key, payload.boardName || label);
        return;
      }

      if (kind === "boardTab") {
        toggleBoardTab(payload.boardId, payload.tab, payload.boardName);
        return;
      }

      toggleKeyword(key);
    });
    return button;
  }

  async function toggleKeyword(keywordValue) {
    const keyword = core.normalizeHeaderKeyword(keywordValue);

    if (!keyword) {
      return;
    }

    const hiddenKeywords = { ...state.settings.hiddenKeywords };

    if (hiddenKeywords[keyword]) {
      delete hiddenKeywords[keyword];
    } else {
      hiddenKeywords[keyword] = keyword;
    }

    await saveSettings({ ...state.settings, hiddenKeywords });
  }

  function createKeywordForm() {
    const form = document.createElement("form");
    form.className = "rbt-keyword-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "rbt-keyword-input";
    input.placeholder = "제목 말머리";
    input.setAttribute("aria-label", "제목 차단 말머리");

    const button = document.createElement("button");
    button.type = "submit";
    button.className = "rbt-source-button";
    button.textContent = "추가";

    form.append(input, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      toggleKeyword(input.value);
      input.value = "";
    });

    return form;
  }

  function createPanelSection(title, emptyText, children) {
    const section = document.createElement("section");
    section.className = "rbt-panel-section";

    const heading = document.createElement("h3");
    heading.textContent = title;

    const body = document.createElement("div");
    body.className = "rbt-chip-grid";

    if (children.length === 0) {
      const empty = document.createElement("span");
      empty.className = "rbt-muted";
      empty.textContent = emptyText;
      body.append(empty);
    } else {
      body.append(...children);
    }

    section.append(heading, body);
    return section;
  }

  function renderToolbarPanel() {
    if (!state.panelNode) {
      return;
    }

    const { boards, boardTabs } = getVisibleSources();
    const boardButtons = boards.map(([boardId, boardName]) => (
      createSourceButton(
        "board",
        boardId,
        getDisplayBoardName(boardName),
        Boolean(state.settings.hiddenBoards[boardId]),
        { boardName }
      )
    ));
    const boardTabButtons = boardTabs.map(([key, tabMeta]) => (
      createSourceButton(
        "boardTab",
        key,
        formatBoardTabLabel(tabMeta.boardId, `[${tabMeta.tab}]`, tabMeta.boardName),
        Boolean(state.settings.hiddenBoardTabs[key]),
        tabMeta
      )
    ));
    const keywordButtons = Object.entries(state.settings.hiddenKeywords || {})
      .sort((a, b) => a[1].localeCompare(b[1], "ko"))
      .map(([keyword, label]) => createSourceButton("keyword", keyword, label, true));
    const keywordChildren = keywordButtons.length > 0
      ? [createKeywordForm(), ...keywordButtons]
      : [createKeywordForm()];

    state.panelNode.replaceChildren(
      createPanelSection("게시판", "현재 목록에서 게시판을 찾지 못했습니다.", boardButtons),
      createPanelSection("게시판 탭", "현재 목록에서 게시판 탭을 찾지 못했습니다.", boardTabButtons),
      createPanelSection("제목 말머리", "추가한 제목 말머리가 없습니다.", keywordChildren)
    );
  }

  function injectToolbar() {
    const listRoot = getListRoot();

    if (!listRoot || document.querySelector(".rbt-toolbar")) {
      return;
    }

    const toolbar = document.createElement("section");
    toolbar.className = "rbt-toolbar";
    toolbar.setAttribute("aria-label", "ㄹㄹ필터");

    const title = document.createElement("strong");
    title.className = "rbt-toolbar-title";
    title.textContent = "ㄹㄹ필터";

    state.statusNode = document.createElement("span");
    state.statusNode.className = "rbt-status";
    state.statusNode.textContent = "준비";

    const boardToggle = document.createElement("button");
    boardToggle.type = "button";
    boardToggle.className = "rbt-control";
    boardToggle.textContent = "게시판";
    boardToggle.addEventListener("click", () => toggleSetting("showBoardLabels"));

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "rbt-control rbt-control-quiet";
    clearButton.textContent = "필터 해제";
    clearButton.addEventListener("click", clearHiddenFilters);

    const details = document.createElement("details");
    details.className = "rbt-filter-panel";
    const summary = document.createElement("summary");
    summary.textContent = "목록 필터";
    state.panelNode = document.createElement("div");
    state.panelNode.className = "rbt-panel-body";
    details.append(summary, state.panelNode);

    toolbar.append(title, state.statusNode, boardToggle, clearButton, details);
    listRoot.before(toolbar);
    state.toolbar = toolbar;

    renderToolbarPanel();
  }

  async function saveBoardCache() {
    const now = Date.now();
    state.boardCache = core.pruneCache(state.boardCache, now);
    await storageSet({
      [core.BOARD_CACHE_KEY]: state.boardCache
    });
  }

  function applyBoardName(boardId, boardName) {
    if (!boardId || !boardName) {
      return;
    }

    state.boardNameById.set(boardId, boardName);

    state.rows.forEach((item) => {
      if (item.meta.boardId !== boardId) {
        return;
      }

      item.meta = {
        ...item.meta,
        boardName
      };
      item.row.dataset.rbtBoardName = boardName;
      renderRowLabels(item);
    });
  }

  function getUnknownBoardIds() {
    const boardIds = new Set();

    state.rows.forEach((item) => {
      const cached = state.boardCache[item.meta.boardId];

      if (getKnownBoardName(item.meta.boardId)) {
        return;
      }

      if (cached && Date.now() - Number(cached.savedAt || 0) < BOARD_LOOKUP_RETRY_DELAY_MS) {
        return;
      }

      boardIds.add(item.meta.boardId);
    });

    return Array.from(boardIds);
  }

  async function fetchBoardName(boardId) {
    const cachedName = getKnownBoardName(boardId);

    if (cachedName) {
      applyBoardName(boardId, cachedName);
      return;
    }

    const response = await fetch(`https://bbs.ruliweb.com/best/board/${boardId}`, {
      credentials: "include",
      cache: "force-cache"
    });

    if (!response.ok) {
      throw new Error(`board fetch failed: ${response.status}`);
    }

    const html = await response.text();
    const boardName = core.parseBoardHtml(html);

    if (!boardName) {
      throw new Error("board name missing");
    }

    state.boardCache[boardId] = {
      boardName,
      savedAt: Date.now()
    };
    applyBoardName(boardId, boardName);
  }

  async function hydrateBoardNames() {
    const queue = getUnknownBoardIds().slice(0, state.settings.maxDetailFetchesPerPage);
    let completed = 0;
    let failed = 0;

    if (queue.length === 0) {
      return 0;
    }

    for (const boardId of queue) {
      if (completed > 0) {
        await sleep(state.settings.detailFetchDelayMs);
      }

      try {
        await fetchBoardName(boardId);
      } catch (error) {
        state.boardCache[boardId] = {
          boardName: "",
          savedAt: Date.now()
        };
        failed += 1;
      }

      completed += 1;
      applyFilters();
      setStatus(`${completed}/${queue.length} 게시판명 확인`, true);
    }

    await saveBoardCache();

    if (failed > 0) {
      setStatus(`${failed}개 게시판명 실패`, false);
      return completed - failed;
    }

    setStatus(`${completed}개 게시판명 확인`, false);
    return completed;
  }

  async function init() {
    if (!getListRoot()) {
      return;
    }

    let stored;
    try {
      stored = await storageGet([core.SETTINGS_KEY, core.BOARD_CACHE_KEY]);
    } catch (error) {
      injectToolbar();
      state.toolbar?.querySelectorAll("button, input").forEach((control) => {
        control.disabled = true;
      });
      setStatus("설정 읽기 실패 · 목록 새로고침 필요", true);
      return;
    }
    state.settings = core.mergeSettings(stored[core.SETTINGS_KEY]);
    state.boardCache = core.pruneCache(stored[core.BOARD_CACHE_KEY], Date.now());

    buildBoardNameMap();
    injectToolbar();
    collectRows();
    state.rows.forEach(renderRowLabels);
    applyFilters();
    try {
      await hydrateBoardNames();
    } catch (error) {
      setStatus("게시판명 cache 저장 실패", false);
      return;
    }

    if (state.rows.length === 0) {
      setStatus("목록 없음", false);
      return;
    }

    setStatus("준비 완료", false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
