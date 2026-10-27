(function attachCore(root) {
  "use strict";

  const SETTINGS_KEY = "rbt_settings";
  const BOARD_CACHE_KEY = "rbt_board_name_cache";
  const FILTER_DOCUMENT_SCHEMA = "ruliweb-best-tab.filters";
  const FILTER_DOCUMENT_VERSION = 1;
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 500;
  const DEFAULT_DETAIL_FETCH_DELAY_MS = 1500;
  const DEFAULT_MAX_DETAIL_FETCHES_PER_PAGE = 8;
  const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
    showBoardLabels: true,
    detailFetchDelayMs: DEFAULT_DETAIL_FETCH_DELAY_MS,
    maxDetailFetchesPerPage: DEFAULT_MAX_DETAIL_FETCHES_PER_PAGE,
    hiddenBoards: {},
    hiddenBoardTabs: {},
    hiddenKeywords: {}
  });

  function normalizeLabel(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^\[|\]$/g, "")
      .trim();
  }

  function formatBoardDisplayName(value) {
    const label = normalizeLabel(value);

    if (!label) {
      return "";
    }

    return label.replace(/\s*게시판$/u, "").trim() || label;
  }

  function makeBoardTabKey(boardId, tabValue) {
    const normalizedBoardId = String(boardId || "").trim();
    const tab = normalizeLabel(tabValue);

    if (!/^\d+$/.test(normalizedBoardId) || !tab) {
      return "";
    }

    return `${normalizedBoardId}::${tab}`;
  }

  function normalizeKeyword(value) {
    return cleanText(value).toLocaleLowerCase("ko-KR");
  }

  function normalizeHeaderKeyword(value) {
    return normalizeKeyword(value)
      .replace(/^[\[(【（]+/g, "")
      .replace(/[\])】）]+$/g, "")
      .trim();
  }

  function stripTags(value) {
    return String(value || "").replace(/<[^>]*>/g, " ");
  }

  function decodeHtml(value) {
    const text = String(value || "");

    if (root.document) {
      const element = root.document.createElement("textarea");
      element.innerHTML = text;
      return element.value;
    }

    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  function cleanText(value) {
    return decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
  }

  function addTitleHeaderKeywords(headers, headerValue) {
    const header = normalizeHeaderKeyword(headerValue);

    if (!header) {
      return;
    }

    [header, ...header.split(/[\/／]+/).map(normalizeHeaderKeyword)]
      .filter(Boolean)
      .forEach((keyword) => {
        if (!headers.includes(keyword)) {
          headers.push(keyword);
        }
      });
  }

  function extractTitleHeaderKeywords(title) {
    let rest = cleanText(title);
    const headers = [];
    let guard = 0;

    while (rest && guard < 6) {
      guard += 1;

      const wrappedMatch = rest.match(/^\s*[\[(【（]\s*([^\])】）]{1,50}?)\s*[\])】）]\s*/);
      const suffixMatch = rest.match(/^\s*([^\s\[(【）】\])]{1,50}?)\s*[\])】）]\s*/);
      const match = wrappedMatch || suffixMatch;

      if (!match) {
        break;
      }

      addTitleHeaderKeywords(headers, match[1]);

      rest = rest.slice(match[0].length).trimStart();
    }

    return headers;
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.min(Math.max(number, min), max);
  }

  function normalizeMapValue(value, fallback) {
    const label = cleanText(value);
    return label || fallback;
  }

  function normalizeHiddenBoards(value) {
    const source = value && typeof value === "object" ? value : {};
    const entries = Object.entries(source)
      .map(([boardId, label]) => {
        const normalizedBoardId = String(boardId || "").trim();

        if (!/^\d+$/.test(normalizedBoardId)) {
          return null;
        }

        return [normalizedBoardId, normalizeMapValue(label, `board ${normalizedBoardId}`)];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  }

  function normalizeHiddenBoardTabs(value) {
    const source = value && typeof value === "object" ? value : {};
    const entries = Object.entries(source)
      .map(([key, label]) => {
        const [boardId, rawTab] = String(key || "").split("::");
        const tab = normalizeLabel(rawTab);
        const normalizedKey = makeBoardTabKey(boardId, tab);

        if (!normalizedKey) {
          return null;
        }

        return [normalizedKey, normalizeMapValue(label, `${boardId} / ${tab}`)];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  }

  function normalizeHiddenKeywords(value) {
    const source = value && typeof value === "object" ? value : {};
    const entries = Object.values(source)
      .map(normalizeHeaderKeyword)
      .filter(Boolean)
      .map((keyword) => [keyword, keyword]);

    return Object.fromEntries(entries);
  }

  function getFilterPayload(settings) {
    const source = settings && typeof settings === "object" ? settings : {};

    return {
      hiddenBoards: normalizeHiddenBoards(source.hiddenBoards),
      hiddenBoardTabs: normalizeHiddenBoardTabs(source.hiddenBoardTabs),
      hiddenKeywords: normalizeHiddenKeywords(source.hiddenKeywords)
    };
  }

  function createFilterDocument(settings, exportedAt) {
    return {
      schema: FILTER_DOCUMENT_SCHEMA,
      version: FILTER_DOCUMENT_VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      filters: getFilterPayload(settings)
    };
  }

  function parseFilterDocument(documentValue) {
    let documentObject = documentValue;

    if (typeof documentValue === "string") {
      documentObject = JSON.parse(documentValue);
    }

    if (!documentObject || typeof documentObject !== "object") {
      throw new Error("Invalid filter document");
    }

    if (
      documentObject.schema !== FILTER_DOCUMENT_SCHEMA
      || Number(documentObject.version) !== FILTER_DOCUMENT_VERSION
      || !documentObject.filters
      || typeof documentObject.filters !== "object"
      || Array.isArray(documentObject.filters)
      || ["hiddenBoards", "hiddenBoardTabs", "hiddenKeywords"].some((key) => {
        const value = documentObject.filters[key];
        return !value || typeof value !== "object" || Array.isArray(value)
          || Object.values(value).some((label) => typeof label !== "string");
      })
    ) {
      throw new Error("Unsupported filter document");
    }

    return getFilterPayload(documentObject.filters);
  }

  function storageGet(chromeApi, keys) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.get(keys, (value) => {
        const error = chromeApi.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || "Storage read failed"));
          return;
        }
        resolve(value || {});
      });
    });
  }

  function storageSet(chromeApi, value) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.set(value, () => {
        const error = chromeApi.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || "Storage write failed"));
          return;
        }
        resolve();
      });
    });
  }

  function applyFilterDocument(settings, documentValue) {
    const filters = parseFilterDocument(documentValue);

    return mergeSettings({
      ...settings,
      ...filters
    });
  }

  function parseArticleHref(href, baseUrl) {
    if (!href) {
      return null;
    }

    let url;

    try {
      url = new URL(href, baseUrl || "https://bbs.ruliweb.com");
    } catch (error) {
      return null;
    }

    if (url.hostname !== "bbs.ruliweb.com") {
      return null;
    }

    const match = url.pathname.match(/\/board\/(\d+)\/read\/(\d+)/);

    if (!match) {
      return null;
    }

    return {
      url: url.href,
      path: url.pathname,
      boardId: match[1],
      articleId: match[2]
    };
  }

  function parseBoardHtml(html) {
    const source = String(html || "");

    if (root.DOMParser) {
      const document = new root.DOMParser().parseFromString(source, "text/html");
      const boardNameNode = document.querySelector("#board_name");
      return cleanText(boardNameNode?.value || boardNameNode?.textContent || "");
    }

    const boardMatch = source.match(/id=["']board_name["'][^>]*value=["']([^"']+)["']/i)
      || source.match(/id=["']board_name["'][^>]*>([\s\S]*?)<\/(?:a|h1|h2|h3|strong|span|div)>/i);

    return cleanText(boardMatch?.[1] || "");
  }

  function mergeSettings(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      version: DEFAULT_SETTINGS.version,
      showBoardLabels: source.showBoardLabels !== false,
      detailFetchDelayMs: clampInteger(
        source.detailFetchDelayMs,
        DEFAULT_SETTINGS.detailFetchDelayMs,
        500,
        10000
      ),
      maxDetailFetchesPerPage: clampInteger(
        source.maxDetailFetchesPerPage,
        DEFAULT_SETTINGS.maxDetailFetchesPerPage,
        1,
        30
      ),
      hiddenBoards: {
        ...DEFAULT_SETTINGS.hiddenBoards,
        ...normalizeHiddenBoards(source.hiddenBoards)
      },
      hiddenBoardTabs: {
        ...DEFAULT_SETTINGS.hiddenBoardTabs,
        ...normalizeHiddenBoardTabs(source.hiddenBoardTabs)
      },
      hiddenKeywords: {
        ...DEFAULT_SETTINGS.hiddenKeywords,
        ...normalizeHiddenKeywords(source.hiddenKeywords)
      }
    };
  }

  function pruneCache(cache, now) {
    const entries = Object.entries(cache && typeof cache === "object" ? cache : {})
      .filter(([, value]) => value && typeof value === "object")
      .filter(([, value]) => now - Number(value.savedAt || 0) < CACHE_TTL_MS)
      .sort(([, a], [, b]) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
      .slice(0, MAX_CACHE_ENTRIES);

    return Object.fromEntries(entries);
  }

  function isRowHiddenBySettings(rowMeta, settings) {
    const boardId = rowMeta?.boardId || "";
    const category = normalizeLabel(rowMeta?.category || "");
    const boardTabKey = makeBoardTabKey(boardId, category);
    const titleHeaders = extractTitleHeaderKeywords(rowMeta?.title || "");
    const hasKeywordMatch = Object.keys(settings.hiddenKeywords || {})
      .map(normalizeHeaderKeyword)
      .some((keyword) => keyword && titleHeaders.includes(keyword));

    return Boolean(
      (boardId && settings.hiddenBoards[boardId])
      || (boardTabKey && settings.hiddenBoardTabs[boardTabKey])
      || hasKeywordMatch
    );
  }

  root.RuliwebBestTab = {
    BOARD_CACHE_KEY,
    CACHE_TTL_MS,
    DEFAULT_DETAIL_FETCH_DELAY_MS,
    DEFAULT_MAX_DETAIL_FETCHES_PER_PAGE,
    DEFAULT_SETTINGS,
    FILTER_DOCUMENT_SCHEMA,
    FILTER_DOCUMENT_VERSION,
    MAX_CACHE_ENTRIES,
    SETTINGS_KEY,
    applyFilterDocument,
    cleanText,
    createFilterDocument,
    extractTitleHeaderKeywords,
    formatBoardDisplayName,
    getFilterPayload,
    makeBoardTabKey,
    mergeSettings,
    normalizeHeaderKeyword,
    normalizeLabel,
    normalizeKeyword,
    parseArticleHref,
    parseBoardHtml,
    parseFilterDocument,
    pruneCache,
    storageGet,
    storageSet,
    isRowHiddenBySettings
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.RuliwebBestTab;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
