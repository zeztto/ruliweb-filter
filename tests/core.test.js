const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("parseArticleHref extracts board and article IDs from best links", () => {
  const article = core.parseArticleHref(
    "/best/board/300143/read/75633175?m=all&t=now",
    "https://bbs.ruliweb.com/best/all"
  );

  assert.equal(article.boardId, "300143");
  assert.equal(article.articleId, "75633175");
  assert.equal(article.path, "/best/board/300143/read/75633175");
});

test("parseArticleHref extracts IDs from non-best board links", () => {
  const article = core.parseArticleHref(
    "https://bbs.ruliweb.com/market/board/1020/read/104953",
    "https://bbs.ruliweb.com/best/all"
  );

  assert.equal(article.boardId, "1020");
  assert.equal(article.articleId, "104953");
});

test("parseBoardHtml reads board name from board pages", () => {
  const html = `
    <div class="board_title">
      <h3 class="col"><a id="board_name" href="https://bbs.ruliweb.com/best/board/300004">NS 정보</a></h3>
    </div>
  `;

  assert.equal(core.parseBoardHtml(html), "NS 정보");
});

test("mergeSettings keeps defaults while accepting user filters", () => {
  const settings = core.mergeSettings({
    hiddenBoards: { 300143: "유머 게시판" }
  });

  assert.equal(settings.showBoardLabels, true);
  assert.equal(settings.detailFetchDelayMs, 1500);
  assert.equal(settings.maxDetailFetchesPerPage, 8);
  assert.equal(settings.hiddenBoards["300143"], "유머 게시판");
  assert.deepEqual(settings.hiddenBoardTabs, {});
  assert.deepEqual(settings.hiddenKeywords, {});
});

test("makeBoardTabKey scopes a tab label to its board", () => {
  assert.equal(core.makeBoardTabKey("300143", "[잡담]"), "300143::잡담");
  assert.equal(core.makeBoardTabKey("300143", " 유머 "), "300143::유머");
  assert.equal(core.makeBoardTabKey("", "유머"), "");
  assert.equal(core.makeBoardTabKey("300143", ""), "");
});

test("formatBoardDisplayName removes duplicated board suffix", () => {
  assert.equal(core.formatBoardDisplayName("유머 게시판"), "유머");
  assert.equal(core.formatBoardDisplayName("NS 정보"), "NS 정보");
  assert.equal(core.formatBoardDisplayName(" board 300143 "), "board 300143");
});

test("isRowHiddenBySettings hides matching board, board tab, or title header keyword", () => {
  const boardTabKey = core.makeBoardTabKey("300143", "잡담");
  const settings = core.mergeSettings({
    hiddenBoards: { 300004: "NS 정보" },
    hiddenBoardTabs: { [boardTabKey]: "유머 게시판 / 잡담" },
    hiddenKeywords: { "니케": "니케", "트릭컬": "트릭컬" }
  });

  assert.equal(core.isRowHiddenBySettings({ boardId: "300004" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300143", category: "[잡담]" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", category: "[잡담]" }, settings), false);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "니케) 새 이벤트" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "(니케) 새 이벤트" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "니케] 새 이벤트" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "[니케] 새 이벤트" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "트릭컬/스포) 새 이벤트" }, settings), true);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "새 이벤트 니케 공개" }, settings), false);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300082", title: "새 이벤트 트릭컬/스포) 공개" }, settings), false);
  assert.equal(core.isRowHiddenBySettings({ boardId: "300143", category: "유머" }, settings), false);
});

test("filter document exports and imports normalized filters", () => {
  const documentValue = core.createFilterDocument({
    hiddenBoards: {
      300143: "유머 게시판",
      invalid: "무시"
    },
    hiddenBoardTabs: {
      "300143::[잡담]": "유머 게시판 / 잡담",
      "bad::잡담": "무시"
    },
    hiddenKeywords: {
      "니케": "니케",
      "스포": "[스포]"
    }
  }, "2026-06-20T00:00:00.000Z");

  assert.equal(documentValue.schema, core.FILTER_DOCUMENT_SCHEMA);
  assert.equal(documentValue.version, core.FILTER_DOCUMENT_VERSION);
  assert.deepEqual(documentValue.filters.hiddenBoards, { "300143": "유머 게시판" });
  assert.deepEqual(documentValue.filters.hiddenBoardTabs, { "300143::잡담": "유머 게시판 / 잡담" });
  assert.deepEqual(documentValue.filters.hiddenKeywords, { "니케": "니케", "스포": "스포" });

  const imported = core.applyFilterDocument(
    core.mergeSettings({ showBoardLabels: false }),
    JSON.stringify(documentValue)
  );

  assert.equal(imported.showBoardLabels, false);
  assert.equal(imported.hiddenBoards["300143"], "유머 게시판");
  assert.equal(imported.hiddenBoardTabs["300143::잡담"], "유머 게시판 / 잡담");
  assert.equal(imported.hiddenKeywords["스포"], "스포");
});

test("normalizeKeyword makes keyword matching case-insensitive", () => {
  assert.equal(core.normalizeKeyword("  Switch 2 "), "switch 2");
});

test("extractTitleHeaderKeywords reads only leading title headers", () => {
  assert.deepEqual(core.extractTitleHeaderKeywords("[니케] (스포) 새 이벤트 니케 공개"), ["니케", "스포"]);
  assert.deepEqual(core.extractTitleHeaderKeywords("트릭컬/스포) 새 이벤트"), ["트릭컬/스포", "트릭컬", "스포"]);
  assert.deepEqual(core.extractTitleHeaderKeywords("새 이벤트 [니케] 공개"), []);
});

test("mergeSettings clamps traffic controls", () => {
  const settings = core.mergeSettings({
    detailFetchDelayMs: 10,
    maxDetailFetchesPerPage: 999
  });

  assert.equal(settings.detailFetchDelayMs, 500);
  assert.equal(settings.maxDetailFetchesPerPage, 30);
});

test("filter import rejects malformed maps without replacing existing filters", () => {
  const settings = core.mergeSettings({ hiddenBoards: { 300143: "유머 게시판" } });
  const empty = { hiddenBoards: {}, hiddenBoardTabs: {}, hiddenKeywords: {} };
  for (const filters of [[], {}, { ...empty, hiddenBoards: [] }, { ...empty, hiddenBoardTabs: null }, { ...empty, hiddenKeywords: { topic: 42 } }]) {
    assert.throws(() => core.applyFilterDocument(settings, {
      schema: core.FILTER_DOCUMENT_SCHEMA, version: 1, filters
    }), /filter document/i);
    assert.equal(settings.hiddenBoards["300143"], "유머 게시판");
  }
  assert.deepEqual(core.parseFilterDocument({
    schema: core.FILTER_DOCUMENT_SCHEMA, version: 1, filters: empty
  }), empty);
});
