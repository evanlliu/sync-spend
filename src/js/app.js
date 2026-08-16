import { ApiClient, loadClientConfig } from "./api.js";
import { consumerUsage, equalShareMap, isSettlementRecord, ledgerSummary, recordShareMap, sanitizeSplitParticipants } from "./calculator.js";
import { convertWithRate, formatRate, getToCnyRate, normalizeRate, roundMoney } from "./currency.js";
import { getLanguage, LANGS, localizedName, setLanguage, t } from "./i18n.js";
import { activeConsumers, clearLegacyDataCache, getLedger, setBootstrap, state } from "./store.js";
import { APP_VERSION } from "./version.js";
import {
  clear,
  clone,
  el,
  formatDate,
  formatDateTime,
  imageFileToDataUrl,
  isIosSafari,
  isStandalonePwa,
  money,
  todayInputValue,
  uid
} from "./utils.js";

const LAST_CURRENCY_KEY = "syncSpend.lastCurrency";
const LAST_LEDGER_KEY = "syncSpend.lastLedgerId";
const RATE_FETCH_DEBOUNCE_MS = 500;

const api = new ApiClient();
const app = document.querySelector("#app");
const toastBox = document.querySelector("#toast");
const modalRoot = document.querySelector("#modal-root");

setLanguage(localStorage.getItem("syncSpend.lang") || "zh-CN");

let clientConfigPromise = null;
let remoteLoadPromise = null;
init();

async function init() {
  bindNetworkEvents();
  preventMobilePageZoom();
  registerServiceWorker();
  clearLegacyDataCache();

  renderShell();
  renderLoading();

  try {
    clientConfigPromise = loadClientConfig().then((clientConfig) => {
      api.applyClientConfig(clientConfig);
      return clientConfig;
    });
    await clientConfigPromise;
  } catch (error) {
    renderLoadError(error);
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return;
  }

  remoteLoadPromise = loadRemote();
  await remoteLoadPromise;

  maybeShowIosInstallTip();
}

function renderShell() {
  updateDocumentTitle();
  clear(app);
  app.append(
    el("div", { className: "app-bg" }, [
      el("div", { className: "orb orb-a" }),
      el("div", { className: "orb orb-b" }),
      el("div", { className: "orb orb-c" })
    ]),
    el("header", { className: `topbar glass topbar-${state.view || "dashboard"}` }, [
      el("button", { className: "brand", on: { click: openMainPage } }, [
        el("img", { attrs: { src: new URL("../../assets/icons/icon-192.png", import.meta.url).toString(), alt: "" } }),
        el("span", { className: "brand-title" }, [
          el("span", { text: getAppTitle() }),
          el("small", { className: "version-badge", text: `v${getAppVersion()}` })
        ])
      ]),
      el("nav", { className: "top-actions" }, [
        mainPageButton(),
        navButton("dashboard", t("dashboard")),
        navButton("settings", t("settings")),
        languageSelect()
      ])
    ]),
    el("main", { className: "main", attrs: { id: "main" } }),
    renderMobileFloatingActions()
  );
}

function renderMobileFloatingActions() {
  if (!state.ready) return el("div", { className: "mobile-fab-dock is-hidden" });

  const ledger = state.view === "ledger" && state.selectedLedgerId ? getLedger(state.selectedLedgerId) : null;
  const addAction = resolveMobileAddAction(ledger);

  const dock = el("div", { className: "mobile-fab-dock", attrs: { "aria-label": "mobile actions" } }, [
    addAction ? el("button", {
      className: `mobile-fab mobile-add-fab ${addAction.className || ""}`,
      attrs: { type: "button", "aria-label": addAction.label },
      on: { click: addAction.onClick }
    }, [
      el("span", { className: "mobile-add-fab-icon" }),
      el("span", { className: "mobile-add-fab-plus", text: "+" })
    ]) : null,
    el("div", { className: "mobile-more-wrap" }, [
      el("button", {
        className: "mobile-fab mobile-more-fab",
        attrs: { type: "button", "aria-label": t("moreActions"), "aria-expanded": "false" },
        on: { click: toggleMobileActionMenu }
      }, [el("span", { text: "•••" })]),
      el("div", { className: "mobile-action-menu glass" }, [
        el("button", { className: `mobile-action-item ${state.view === "ledger" ? "is-active" : ""}`, text: t("mainPage"), on: { click: () => { closeMobileActionMenu(); openMainPage(); } } }),
        el("button", { className: `mobile-action-item ${state.view === "dashboard" ? "is-active" : ""}`, text: t("dashboard"), on: { click: () => { closeMobileActionMenu(); navigate("dashboard"); } } }),
        el("button", { className: `mobile-action-item ${state.view === "settings" ? "is-active" : ""}`, text: t("settings"), on: { click: () => { closeMobileActionMenu(); navigate("settings"); } } }),
        el("label", { className: "mobile-action-lang" }, [
          el("span", { text: t("language") }),
          mobileLanguageSelect()
        ])
      ])
    ])
  ]);

  return dock;
}

function resolveMobileAddAction(ledger) {
  if (!state.ready) return null;
  if (state.view === "ledger" && ledger) {
    return { label: t("addExpense"), onClick: () => showExpenseModal(ledger) };
  }
  if (state.view === "dashboard") {
    return { label: t("createLedger"), onClick: () => showLedgerModal(), className: "mobile-ledger-add-fab" };
  }
  if (state.view === "settings") {
    return { label: t("addConsumer"), onClick: () => showConsumerModal(), className: "mobile-consumer-add-fab" };
  }
  return null;
}

function mobileLanguageSelect() {
  const select = languageSelect();
  select.classList.add("mobile-action-select");
  return select;
}

function toggleMobileActionMenu(event) {
  const wrap = event.currentTarget.closest(".mobile-more-wrap");
  if (!wrap) return;
  const open = !wrap.classList.contains("is-open");
  document.querySelectorAll(".mobile-more-wrap.is-open").forEach((item) => item.classList.remove("is-open"));
  wrap.classList.toggle("is-open", open);
  event.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeMobileActionMenu() {
  document.querySelectorAll(".mobile-more-wrap.is-open").forEach((item) => item.classList.remove("is-open"));
}

function getAppTitle() {
  return localizedName(state.config?.app?.name, t("appName")) || t("appName");
}

function getAppVersion() {
  return String(APP_VERSION).replace(/^v/i, "");
}

function updateDocumentTitle() {
  const title = `${getAppTitle()} v${getAppVersion()}`;
  document.title = title;
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute("content", title);
}

function navButton(view, label) {
  return el("button", {
    className: `btn ghost nav-btn ${state.view === view ? "is-active" : ""}`,
    text: label,
    on: { click: () => navigate(view) }
  });
}

function mainPageButton() {
  return el("button", {
    className: `btn ghost nav-btn ${state.view === "ledger" ? "is-active" : ""}`,
    text: t("mainPage"),
    on: { click: openMainPage }
  });
}

function languageSelect() {
  const select = el("select", { className: "select compact", attrs: { "aria-label": t("language") } });
  for (const lang of LANGS) {
    select.append(el("option", { text: lang.label, attrs: { value: lang.code, selected: getLanguage() === lang.code } }));
  }
  select.addEventListener("change", () => {
    setLanguage(select.value);
    renderShell();
    renderApp();
  });
  return select;
}

async function loadRemote() {
  state.loading = true;
  state.refreshing = false;
  state.remoteReady = false;
  renderLoading();
  try {
    const payload = await api.bootstrap();
    setBootstrap(payload);
    restoreLastOpenedLedger();
    renderShell();
    renderApp();
    return true;
  } catch (error) {
    state.ready = false;
    state.remoteReady = false;
    renderLoadError(error);
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return false;
  } finally {
    state.loading = false;
    state.refreshing = false;
  }
}

function renderLoading() {
  const main = document.querySelector("#main");
  if (!main) return;
  clear(main);
  main.append(el("section", { className: "glass center-card" }, [
    el("div", { className: "loader" }),
    el("p", { className: "muted", text: t("refreshingData") })
  ]));
}

function renderLoadError(error) {
  renderShell();
  const main = document.querySelector("#main");
  if (!main) return;
  clear(main);
  main.append(el("section", { className: "glass center-card" }, [
    el("h1", { text: t("loadFailed") }),
    el("p", { className: "muted", text: error?.message || t("loadFailed") }),
    el("div", { className: "row-actions" }, [
      el("button", { className: "btn primary", text: t("refreshData"), on: { click: loadRemote } })
    ])
  ]));
}

function renderApp() {
  const main = document.querySelector("#main");
  if (!main) return;
  clear(main);

  if (state.view === "settings") {
    main.append(renderSettings());
    return;
  }

  if (state.view === "ledger" && state.selectedLedgerId) {
    const ledger = getLedger(state.selectedLedgerId);
    if (ledger) {
      main.append(renderLedgerDetail(ledger));
      return;
    }
    const fallbackLedger = getDefaultLedger();
    if (fallbackLedger) {
      state.view = "ledger";
      state.selectedLedgerId = fallbackLedger.id;
      saveLastOpenedLedgerId(fallbackLedger.id);
      main.append(renderLedgerDetail(fallbackLedger));
      return;
    }
    state.view = "dashboard";
  }

  if (state.view !== "dashboard") {
    const ledger = getDefaultLedger();
    if (ledger) {
      state.view = "ledger";
      state.selectedLedgerId = ledger.id;
      saveLastOpenedLedgerId(ledger.id);
      main.append(renderLedgerDetail(ledger));
      return;
    }
  }

  main.append(renderDashboard());
}

function navigate(view, ledgerId = null) {
  state.view = view;
  state.selectedLedgerId = ledgerId;
  if (view === "ledger" && ledgerId) saveLastOpenedLedgerId(ledgerId);
  renderShell();
  renderApp();
}

function saveLastOpenedLedgerId(ledgerId) {
  const id = String(ledgerId || "").trim();
  if (id) localStorage.setItem(LAST_LEDGER_KEY, id);
}

function getLastOpenedLedgerId() {
  return localStorage.getItem(LAST_LEDGER_KEY) || "";
}

function clearLastOpenedLedgerId(ledgerId) {
  if (!ledgerId || getLastOpenedLedgerId() === ledgerId) localStorage.removeItem(LAST_LEDGER_KEY);
}

function getDefaultLedger() {
  const ledgers = Array.isArray(state.data?.ledgers) ? state.data.ledgers : [];
  const last = getLastOpenedLedgerId();
  if (last) {
    const saved = getLedger(last);
    if (saved) return saved;
  }
  return ledgers.find((ledger) => !ledger.archived) || ledgers[0] || null;
}

function openMainPage() {
  const ledger = getDefaultLedger();
  if (ledger) {
    navigate("ledger", ledger.id);
    return;
  }
  navigate("dashboard");
}

function restoreLastOpenedLedger() {
  const ledger = getDefaultLedger();
  if (ledger) {
    state.view = "ledger";
    state.selectedLedgerId = ledger.id;
    saveLastOpenedLedgerId(ledger.id);
    return true;
  }
  state.view = "dashboard";
  state.selectedLedgerId = null;
  return false;
}

function renderDashboard() {
  const active = state.data.ledgers.filter((ledger) => !ledger.archived);
  const archived = state.data.ledgers.filter((ledger) => ledger.archived);
  const section = el("section", { className: "page-grid" });

  section.append(
    el("div", { className: "hero glass" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: t("baseCurrency") }),
        el("h1", { text: t("dashboard") }),
        el("p", { className: "muted", text: `${t("lastSync")}: ${formatDateTime(state.lastSync)}` })
      ]),
      el("div", { className: "hero-actions" }, [
        el("button", { className: "btn primary", text: t("createLedger"), on: { click: () => showLedgerModal() } }),
        el("button", { className: "btn ghost", text: t("refreshData"), on: { click: refreshData } }),
        el("button", { className: "btn ghost", text: t("refreshRate"), on: { click: refreshRates } })
      ])
    ]),
    renderLedgerList(t("activeLedgers"), active, false),
    renderLedgerList(t("archivedLedgers"), archived, true),
    renderRatesCard({ collapsed: true })
  );
  return section;
}

function renderRatesCard({ collapsed = false } = {}) {
  const rows = (state.config.currencies || []).map((currency) => {
    const rate = getToCnyRate(currency.code, state.rates);
    return el("div", { className: "rate-row" }, [
      el("span", { text: `${currency.code} · ${localizedName(currency.name, currency.code)}` }),
      el("strong", { text: rate ? `1 ${currency.code} = ${formatRate(rate)} CNY` : "-" })
    ]);
  });

  return el("details", { className: "glass card collapsible-card", attrs: { open: collapsed ? false : true } }, [
    el("summary", { className: "card-head collapsible-summary" }, [
      el("div", { className: "summary-title" }, [
        el("h2", { text: t("exchangeRate") }),
        el("p", { className: "muted", text: `${t("updated")}: ${state.rates?.date || state.rates?.fetchedAt || "-"}` })
      ]),
      el("span", { className: "pill", text: state.rates?.error ? "api error" : state.rates?.provider || "-" })
    ]),
    el("div", { className: "collapsible-body" }, [
      ...rows,
      ...(state.rates?.error
        ? [el("p", { className: "hint danger-text", text: `${t("rateApiError")}: ${state.rates.error}` })]
        : []),
      el("p", { className: "hint", text: t("rateTip") })
    ])
  ]);
}

function renderLedgerList(title, ledgers, archived) {
  const headChildren = [
    el("h2", { text: title }),
    el("span", { className: "pill", text: String(ledgers.length) })
  ];

  const body = el("div", { className: archived ? "collapsible-body ledger-collapsible-body" : "ledger-list-body" });
  if (!ledgers.length) {
    body.append(el("p", { className: "muted", text: archived ? "-" : t("noLedger") }));
  } else {
    const grid = el("div", { className: "ledger-grid" });
    for (const ledger of ledgers) grid.append(renderLedgerCard(ledger));
    body.append(grid);
  }

  if (archived) {
    return el("details", { className: "glass card ledger-section collapsible-card archived-ledger-section" }, [
      el("summary", { className: "card-head collapsible-summary" }, headChildren),
      body
    ]);
  }

  return el("section", { className: "glass card ledger-section" }, [
    el("div", { className: "card-head" }, headChildren),
    body
  ]);
}

function renderLedgerCard(ledger) {
  const summary = ledgerSummary(ledger, state.config);
  return el("article", { className: "ledger-card liquid-card" }, [
    el("div", { className: "ledger-card-main" }, [
      el("h3", { text: ledger.name }),
      el("p", { className: "muted", text: `${t("participants")}: ${summary.participants.map((p) => localizedName(p.name, p.id)).join(" / ") || "-"}` }),
      el("div", { className: "metric-row" }, [
        metric(t("total"), money(summary.totalCny, "CNY")),
        metric(t("perPerson"), money(summary.perPerson, "CNY"))
      ])
    ]),
    el("div", { className: "row-actions" }, [
      el("button", { className: "btn primary small", text: t("openLedger"), on: { click: () => navigate("ledger", ledger.id) } }),
      el("button", { className: "btn ghost small", text: ledger.archived ? t("unarchive") : t("archive"), on: { click: () => toggleArchive(ledger.id) } }),
      ledger.archived ? el("button", { className: "btn danger small", text: t("deleteLedger"), on: { click: () => deleteArchivedLedger(ledger.id) } }) : null
    ])
  ]);
}

function metric(label, value) {
  return el("div", { className: "metric" }, [el("span", { text: label }), el("strong", { text: value })]);
}

function renderLedgerDetail(ledger) {
  const summary = ledgerSummary(ledger, state.config);
  return el("section", { className: "ledger-detail" }, [
    el("div", { className: "hero glass ledger-hero" }, [
      el("div", { className: "ledger-hero-main" }, [
        renderLedgerSwitcher(ledger),
        renderLedgerHeroSummary(summary)
      ]),
      el("div", { className: "hero-actions" }, [
        el("button", { className: "btn settle", text: t("settleNow"), on: { click: () => showSettlementModal(ledger) } }),
        el("button", { className: "btn primary", text: t("addExpense"), on: { click: () => showExpenseModal(ledger) } }),
        el("button", { className: "btn ghost", text: t("edit"), on: { click: () => showLedgerModal(ledger) } }),
        el("button", { className: "btn ghost", text: ledger.archived ? t("unarchive") : t("archive"), on: { click: () => toggleArchive(ledger.id) } }),
        ledger.archived ? el("button", { className: "btn danger", text: t("deleteLedger"), on: { click: () => deleteArchivedLedger(ledger.id) } }) : null
      ])
    ]),
    el("div", { className: "summary-grid summary-grid-no-settlement" }, [
      renderBalances(summary)
    ]),
    renderRecords(ledger, summary.records)
  ]);
}



function renderLedgerSwitcher(currentLedger) {
  const select = el("select", {
    className: "ledger-title-select",
    attrs: { "aria-label": t("switchLedger") }
  });

  const ledgers = Array.isArray(state.data?.ledgers) ? state.data.ledgers : [];
  const active = ledgers.filter((ledger) => !ledger.archived);
  const archived = ledgers.filter((ledger) => ledger.archived);

  const appendOptions = (items, suffix = "") => {
    for (const ledger of items) {
      select.append(el("option", {
        text: `${ledger.name}${suffix}`,
        attrs: { value: ledger.id, selected: ledger.id === currentLedger.id }
      }));
    }
  };

  appendOptions(active);
  appendOptions(archived, ` · ${t("archived")}`);

  select.addEventListener("change", () => {
    const ledgerId = select.value;
    if (ledgerId && ledgerId !== currentLedger.id) navigate("ledger", ledgerId);
  });

  return el("label", { className: "ledger-title-switcher" }, [
    el("span", { className: "sr-only", text: t("switchLedger") }),
    select
  ]);
}

function renderLedgerHeroSummary(summary) {
  return el("div", { className: "ledger-hero-summary" }, [
    el("div", { className: "ledger-hero-summary-main" }, [
      el("span", { className: "ledger-hero-summary-label", text: t("total") }),
      el("strong", { className: "ledger-hero-summary-total", text: money(summary.totalCny, "CNY") })
    ]),
    renderCurrencyTotals(summary, true),
    el("div", { className: "ledger-hero-summary-foot" }, [
      el("span", { className: "ledger-hero-summary-meta", text: `${t("perPerson")}: ${money(summary.perPerson, "CNY")}` }),
      summary.unallocatedCny > 0.01 ? el("span", { className: "ledger-hero-summary-meta warn", text: `${t("unallocated")}: ${money(summary.unallocatedCny, "CNY")}` }) : null
    ])
  ]);
}

function renderCurrencyTotals(summary, compact = false) {
  const entries = Object.entries(summary.totalByCurrency || {})
    .filter(([, value]) => Math.abs(Number(value || 0)) > 0.001)
    .sort(([a], [b]) => {
      if (a === "CNY") return -1;
      if (b === "CNY") return 1;
      return a.localeCompare(b);
    });

  if (!entries.length) return el("p", { className: `muted currency-totals-empty${compact ? " compact" : ""}`, text: `${t("currencyTotals")}: -` });

  return el("div", { className: `currency-totals${compact ? " compact" : ""}` }, [
    el("span", { text: t("currencyTotals") }),
    el("div", { className: "currency-total-list" }, entries.map(([currency, value]) => (
      el("strong", { className: "currency-total-pill", text: money(value, currency) })
    )))
  ]);
}

function renderBalances(summary) {
  const rows = summary.balances.map((item) => el("div", { className: "balance-row" }, [
    el("strong", { className: "balance-name", text: localizedName(item.consumer.name, item.consumerId) }),
    el("div", { className: "balance-values" }, [
      el("span", {}, [el("small", { text: t("paid") }), el("b", { text: money(item.paid, "CNY") })]),
      el("span", {}, [el("small", { text: t("shareAmount") }), el("b", { text: money(item.share, "CNY") })]),
      el("span", {}, [el("small", { text: t("settledPaid") }), el("b", { className: "settlement-paid", text: money(item.settlementPaid, "CNY") })]),
      el("span", {}, [el("small", { text: t("settledReceived") }), el("b", { className: "settlement-received", text: money(item.settlementReceived, "CNY") })]),
      el("span", {}, [el("small", { text: t("net") }), el("b", { className: item.balance >= 0 ? "pos" : "neg", text: money(item.balance, "CNY") })])
    ])
  ]));

  return el("article", { className: "glass card balance-card" }, [
    el("h2", { text: t("balance") }),
    el("p", { className: "muted balance-caption", text: t("balanceAfterSettlement") }),
    el("div", { className: "balance-list" }, rows)
  ]);
}

function renderRecords(ledger, records) {
  const card = el("article", { className: "glass card records-card" }, [
    el("div", { className: "card-head" }, [el("h2", { text: t("records") }), el("span", { className: "pill", text: String(records.length) })])
  ]);

  if (!records.length) {
    card.append(el("p", { className: "muted", text: t("noRecord") }));
    return card;
  }

  const list = el("div", { className: "record-list timeline-list" });
  const sorted = records.slice().sort((a, b) => recordSortTime(b).localeCompare(recordSortTime(a)));
  let lastDateKey = "";
  for (const record of sorted) {
    const dateKey = recordDateKey(record);
    if (dateKey && dateKey !== lastDateKey) {
      list.append(el("div", { className: "mobile-record-date", text: formatMobileRecordDate(dateKey) }));
      lastDateKey = dateKey;
    }
    list.append(isSettlementRecord(record) ? renderSettlementRecord(ledger, record) : renderExpenseRecord(ledger, record));
  }
  card.append(list);
  return card;
}

function recordDateKey(record) {
  const source = String(record.date || record.createdAt || record.updatedAt || "");
  return source.slice(0, 10);
}

function formatMobileRecordDate(dateKey) {
  if (!dateKey) return "";
  try {
    return new Intl.DateTimeFormat(getLanguage() === "en-US" ? "en-US" : "zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(new Date(`${dateKey}T00:00:00`));
  } catch {
    return dateKey;
  }
}

function renderExpenseRecord(ledger, record) {
  const payerName = consumerName(record.consumerId);
  const participantNames = sanitizeSplitParticipants(record, ledger.participantIds).map(consumerName).join(" / ");
  const shareEntries = Object.entries(recordShareMap(record, ledger.participantIds));

  return recordCard("expense-record", [
    record.photo ? photoThumb(record.photo) : el("div", { className: "record-photo placeholder", text: "📷" }),
    el("div", { className: "record-body record-body-enhanced" }, [
      el("div", { className: "record-primary-line" }, [
        el("div", { className: "record-story" }, [
          el("span", { className: "record-action-badge expense", text: t("expense") }),
          el("strong", { className: "record-payer", text: payerName }),
          el("span", { className: "record-action-text", text: t("paidAmount") }),
          el("strong", { className: "record-original-amount", text: money(record.amount, record.currency) })
        ]),
        el("div", { className: "record-cny-highlight" }, [
          el("small", { text: t("cnyValue") }),
          el("strong", { text: money(record.amountCny, "CNY") })
        ])
      ]),
      el("div", { className: "record-meta-grid" }, [
        recordMetaChip(t("date"), formatDate(record.date), "date"),
        recordMetaChip(t("rate"), formatRate(record.rateToCny) || "-", "rate"),
        recordMetaChip(t("createdAt"), formatDateTime(record.createdAt), "created"),
        recordMetaChip(t("updatedAt"), formatDateTime(record.updatedAt), "updated"),
        recordMetaChip(t("splitMethod"), record.splitMode === "amount" ? t("splitByAmount") : t("splitEqual"), "split-method"),
        recordMetaChip(t("splitParticipants"), participantNames || "-", "split-participants")
      ]),
      shareEntries.length ? el("div", { className: "record-share-grid" }, shareEntries.map(([id, value]) => (
        el("span", { className: "record-share-chip" }, [
          el("small", { text: consumerName(id) }),
          el("strong", { text: money(value, "CNY") })
        ])
      ))) : null,
      record.note ? el("p", { className: "record-note", text: record.note }) : null,
      renderRecordHistory(record)
    ])
  ], [
    el("button", { className: "btn ghost small swipe-edit", text: t("edit"), on: { click: () => showExpenseModal(ledger, record) } }),
    el("button", { className: "btn danger small swipe-delete", text: t("delete"), on: { click: () => deleteRecord(ledger.id, record.id) } })
  ]);
}

function renderSettlementRecord(ledger, record) {
  const from = consumerName(record.fromConsumerId);
  const to = consumerName(record.toConsumerId);
  const amount = roundMoney(record.amountCny || record.amount || 0);

  return recordCard("settlement-record", [
    el("div", { className: "record-photo settlement-icon", text: "✓" }),
    el("div", { className: "record-body record-body-enhanced" }, [
      el("div", { className: "record-primary-line" }, [
        el("div", { className: "record-story settlement-story" }, [
          el("span", { className: "record-action-badge settlement", text: t("settlementRecord") }),
          el("strong", { className: "record-payer debtor-text", text: from }),
          el("span", { className: "route-arrow", text: "→" }),
          el("strong", { className: "record-payer creditor-text", text: to })
        ]),
        el("div", { className: "record-cny-highlight settlement-highlight" }, [
          el("small", { text: t("paidSettlement") }),
          el("strong", { text: money(amount, "CNY") })
        ])
      ]),
      el("p", { className: "settlement-record-readable", text: t("settlementRecordText", { from, to, amount: money(amount, "CNY") }) }),
      el("div", { className: "record-meta-grid" }, [
        recordMetaChip(t("date"), formatDate(record.date), "date"),
        recordMetaChip(t("createdAt"), formatDateTime(record.createdAt), "created"),
        recordMetaChip(t("updatedAt"), formatDateTime(record.updatedAt), "updated"),
        recordMetaChip(t("recordType"), t("settlementRecord"), "record-type")
      ]),
      record.note ? el("p", { className: "record-note", text: record.note }) : null,
      renderRecordHistory(record)
    ])
  ], [
    el("button", { className: "btn danger small swipe-delete", text: t("delete"), on: { click: () => deleteRecord(ledger.id, record.id) } })
  ]);
}

function recordCard(extraClassName, contentChildren, actionChildren) {
  const node = el("div", { className: `record-item liquid-card record-item-enhanced swipe-record ${extraClassName}` }, [
    el("div", { className: "record-swipe-content" }, contentChildren),
    el("div", { className: "row-actions vertical swipe-actions" }, actionChildren)
  ]);
  installSwipeReveal(node);
  return node;
}

function installSwipeReveal(node) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  node.addEventListener("pointerdown", (event) => {
    if (!isMobileViewport()) return;
    if (event.target.closest("button, a, input, select, textarea, summary, .row-actions")) return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });

  node.addEventListener("pointermove", (event) => {
    if (!tracking || !isMobileViewport()) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 26 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) {
      closeOtherSwipeRecords(node);
      node.classList.add("swiped");
      document.body.classList.add("mobile-record-actions-open");
    } else {
      node.classList.remove("swiped");
      updateSwipeOpenState();
    }
    tracking = false;
  });

  node.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    if (!isMobileViewport()) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && node.classList.contains("swiped")) {
      node.classList.remove("swiped");
      updateSwipeOpenState();
    }
  });
}

function closeOtherSwipeRecords(current) {
  document.querySelectorAll(".swipe-record.swiped").forEach((item) => {
    if (item !== current) item.classList.remove("swiped");
  });
  updateSwipeOpenState();
}

function updateSwipeOpenState() {
  document.body.classList.toggle("mobile-record-actions-open", Boolean(document.querySelector(".swipe-record.swiped")));
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function recordSortTime(record) {
  return String(record.createdAt || record.updatedAt || (record.date ? `${record.date}T00:00:00.000Z` : ""));
}

function renderRecordHistory(record) {
  const history = Array.isArray(record.history) ? record.history : [];
  const rows = [];
  const hasCreatedHistory = history.some((item) => item.action === "created" || item.type === "created");
  const hasUpdatedHistory = history.some((item) => item.action === "updated" || item.type === "updated");
  if (record.createdAt && !hasCreatedHistory) rows.push({ at: record.createdAt, action: "created" });
  if (record.updatedAt && record.updatedAt !== record.createdAt && !hasUpdatedHistory) rows.push({ at: record.updatedAt, action: "updated" });
  for (const item of history) rows.push(item);

  const deduped = [];
  const seen = new Set();
  for (const item of rows) {
    const key = `${item.action || item.type || "history"}|${item.at || ""}|${item.summary || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  if (!deduped.length) return null;
  return el("details", { className: "record-history" }, [
    el("summary", { text: `${t("history")}${deduped.length ? ` · ${deduped.length}` : ""}` }),
    el("div", { className: "history-list" }, deduped.slice().reverse().map((item) => el("div", { className: "history-row" }, [
      el("span", { className: "history-dot" }),
      el("div", {}, [
        el("strong", { text: historyActionLabel(item.action || item.type) }),
        el("small", { text: formatDateTime(item.at) }),
        item.summary ? el("p", { text: item.summary }) : null
      ])
    ])))
  ]);
}

function historyActionLabel(action) {
  const key = `history_${action || "updated"}`;
  return t(key);
}

function recordMetaChip(label, value, key = "") {
  const safeKey = key ? ` meta-${key}` : "";
  return el("span", { className: `record-meta-chip${safeKey}` }, [
    el("small", { text: label }),
    el("strong", { text: value })
  ]);
}

function photoThumb(src) {
  return el("button", { className: "record-photo-btn", attrs: { type: "button", "aria-label": t("viewPhoto") }, on: { click: () => showImageViewer(src) } }, [
    el("img", { className: "record-photo", attrs: { src, alt: t("photo") } })
  ]);
}

function renderSettings() {
  return el("section", { className: "settings-grid" }, [
    el("div", { className: "hero glass" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: "config.json" }),
        el("h1", { text: t("settings") }),
        el("p", { className: "muted", text: t("rateTip") })
      ]),
      el("div", { className: "hero-actions" }, [
        el("button", { className: "btn primary", text: t("addConsumer"), on: { click: () => showConsumerModal() } }),
        el("button", { className: "btn ghost", text: t("refreshRate"), on: { click: refreshRates } })
      ])
    ]),
    renderConsumerSettings(),
    renderConfigInfo()
  ]);
}

function renderConsumerSettings() {
  const list = el("div", { className: "consumer-list" });
  for (const consumer of state.config.consumers || []) {
    const usage = consumerUsage(state.data, consumer.id);
    const isReferenced = usage.ledgerCount > 0 || usage.recordCount > 0;
    const statusText = consumer.active === false ? t("inactive") : t("active");
    const usageText = isReferenced
      ? t("consumerUsage", { ledgers: usage.ledgerCount, records: usage.recordCount })
      : t("consumerUnused");

    list.append(el("div", { className: "consumer-item liquid-card" }, [
      el("div", {}, [
        el("strong", { text: localizedName(consumer.name, consumer.id) }),
        el("p", { className: "muted", text: `${statusText} · ${usageText}` })
      ]),
      el("div", { className: "row-actions" }, [
        el("button", { className: "btn ghost small", text: t("edit"), on: { click: () => showConsumerModal(consumer) } }),
        isReferenced
          ? (consumer.active !== false
            ? el("button", { className: "btn danger small", text: t("deactivate"), on: { click: () => handleConsumerRemoval(consumer.id) } })
            : null)
          : el("button", { className: "btn danger small", text: t("delete"), on: { click: () => handleConsumerRemoval(consumer.id) } })
      ])
    ]));
  }
  return el("article", { className: "glass card" }, [
    el("div", { className: "card-head" }, [el("h2", { text: t("consumers") }), el("span", { className: "pill", text: String((state.config.consumers || []).length) })]),
    list
  ]);
}

function renderConfigInfo() {
  let github;
  try {
    github = api.getConnectionInfo();
  } catch {
    return el("article", { className: "glass card" }, [
      el("h2", { text: "GitHub Direct API" }),
      el("p", { className: "muted", text: t("connectionLoading") })
    ]);
  }

  const rows = {
    owner: github.owner,
    repo: github.repo,
    branch: github.branch,
    dataPath: github.dataPath,
    configPath: github.configPath,
    token: github.hasToken ? "已加密配置 / 仅内存解密" : "-",
    tokenProtection: github.tokenProtection || "-"
  };
  return el("article", { className: "glass card" }, [
    el("h2", { text: "GitHub Direct API" }),
    el("p", { className: "muted", text: "前端直接通过 GitHub REST API 读写数据分支，不再依赖 Cloudflare Worker。连接参数来自 release 分支的 data/config.json；GitHub Token 以 DES Base64 密文保存，运行时仅在内存中解密。" }),
    el("div", { className: "kv-list" }, Object.entries(rows).map(([key, value]) => el("div", {}, [el("span", { text: key }), el("strong", { text: String(value || "-") })]))),
    renderRatesCard({ collapsed: false })
  ]);
}

async function showLedgerModal(ledger = null) {
  const requestedLedgerId = ledger?.id || null;
  try {
    await ensureFullDataForMutation();
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return;
  }

  ledger = requestedLedgerId ? getLedger(requestedLedgerId) : null;
  if (requestedLedgerId && !ledger) {
    toast(t("ledgerNotFound"), "error");
    return;
  }

  const editing = Boolean(ledger);
  const ledgerId = ledger?.id || null;
  const draft = editing ? clone(ledger) : {
    id: uid("ledger"),
    name: "",
    archived: false,
    participantIds: activeConsumers().map((consumer) => consumer.id),
    records: [],
    createdAt: new Date().toISOString()
  };

  const nameInput = input({ name: "name", value: draft.name, required: true });
  const checks = el("div", { className: "check-grid ledger-participant-grid" });
  const optionIds = Array.from(new Set([
    ...activeConsumers().map((consumer) => consumer.id),
    ...(editing && Array.isArray(draft.participantIds) ? draft.participantIds : [])
  ]));

  for (const consumerId of optionIds) {
    const consumer = (state.config.consumers || []).find((item) => item.id === consumerId);
    const label = consumer
      ? localizedName(consumer.name, consumer.id)
      : consumerId;
    const status = consumer?.active === false ? ` · ${t("inactive")}` : "";
    const checkbox = el("input", { attrs: { type: "checkbox", value: consumerId, checked: draft.participantIds.includes(consumerId) } });
    checks.append(el("label", { className: "check-pill ledger-participant-pill" }, [checkbox, el("span", { text: `${label}${status}` })]));
  }

  const formChildren = [
    el("section", { className: "ledger-form-section ledger-form-primary" }, [
      el("div", { className: "ledger-form-section-title" }, [
        el("strong", { text: t("basicInfo") }),
        el("span", { text: editing ? t("editLedgerHint") : t("createLedgerHint") })
      ]),
      field(t("ledgerName"), nameInput)
    ]),
    el("section", { className: "ledger-form-section ledger-form-participants" }, [
      el("div", { className: "ledger-form-section-title" }, [
        el("strong", { text: t("participants") }),
        el("span", { text: t("participantsHint") })
      ]),
      checks
    ]),
    editing ? el("section", { className: "ledger-form-section ledger-form-time" }, [
      el("div", { className: "ledger-form-section-title" }, [
        el("strong", { text: t("ledgerTimeInfo") }),
        el("span", { text: t("readonly") })
      ]),
      el("div", { className: "ledger-time-grid" }, [
        el("div", { className: "ledger-time-item" }, [
          el("span", { text: t("createdAt") }),
          el("strong", { text: formatDateTime(draft.createdAt) || "-" })
        ]),
        el("div", { className: "ledger-time-item" }, [
          el("span", { text: t("updatedAt") }),
          el("strong", { text: draft.updatedAt ? formatDateTime(draft.updatedAt) : "-" })
        ])
      ])
    ]) : null,
    modalActions()
  ];

  openModal(editing ? t("editLedger") : t("createLedger"), el("form", { className: "form ledger-form", on: { submit } }, formChildren), "ledger-modal-shell");

  async function submit(event) {
    event.preventDefault();
    const participantIds = Array.from(checks.querySelectorAll("input:checked")).map((node) => node.value);
    if (!participantIds.length) {
      toast(t("emptyParticipants"), "error");
      return;
    }

    const name = nameInput.value.trim();
    if (!name) return;
    const now = new Date().toISOString();

    let savedLedgerId = draft.id;
    const saved = await commitDataMutation((nextData) => {
      if (editing) {
        const target = nextData.ledgers.find((item) => item.id === ledgerId);
        if (!target) throw new Error(t("ledgerNotFound"));
        materializeLegacySplitSnapshots(target);
        target.name = name;
        target.participantIds = participantIds.slice();
        target.updatedAt = now;
        return;
      }

      const createdLedger = {
        ...clone(draft),
        name,
        participantIds: participantIds.slice(),
        createdAt: draft.createdAt || now,
        updatedAt: now
      };
      createdLedger.id = allocateEntityId("ledger", nextData.ledgers, createdLedger.id);
      savedLedgerId = createdLedger.id;
      nextData.ledgers.unshift(createdLedger);
    }, { render: editing });

    if (!saved) return;
    closeModal();
    if (!editing) navigate("ledger", savedLedgerId);
  }
}

function getPreferredCurrency() {
  const saved = localStorage.getItem(LAST_CURRENCY_KEY) || "";
  const exists = (state.config.currencies || []).some((item) => item.code === saved);
  return exists ? saved : "CNY";
}

function savePreferredCurrency(currency) {
  const code = String(currency || "").trim();
  const exists = (state.config.currencies || []).some((item) => item.code === code);
  if (exists) localStorage.setItem(LAST_CURRENCY_KEY, code);
}

function allocateEntityId(prefix, items = [], preferredId = "") {
  const used = new Set((items || []).map((item) => String(item?.id || "").trim()).filter(Boolean));
  let candidate = String(preferredId || "").trim();
  while (!candidate || used.has(candidate)) candidate = uid(prefix);
  return candidate;
}

function appendRecordHistory(record, action, summary = "", at = new Date().toISOString()) {
  record.history = Array.isArray(record.history) ? record.history : [];
  record.history.push({ action, at, summary });
}

function expenseHistorySummary(record) {
  if (!record) return "";
  if (isSettlementRecord(record)) {
    return t("settlementRecordText", {
      from: consumerName(record.fromConsumerId),
      to: consumerName(record.toConsumerId),
      amount: money(record.amountCny || record.amount || 0, "CNY")
    });
  }
  return `${consumerName(record.consumerId)} ${money(record.amount, record.currency)} / ${money(record.amountCny, "CNY")}`;
}

async function showExpenseModal(ledger, record = null) {
  const requestedLedgerId = ledger?.id;
  const requestedRecordId = record?.id || null;
  try {
    await ensureFullDataForMutation();
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return;
  }

  ledger = getLedger(requestedLedgerId);
  if (!ledger) {
    toast(t("ledgerNotFound"), "error");
    return;
  }
  record = requestedRecordId ? ledger.records?.find((item) => item.id === requestedRecordId && !item.deleted) : null;
  if (requestedRecordId && !record) {
    toast(t("recordNotFound"), "error");
    return;
  }

  const editing = Boolean(record);
  const ledgerId = ledger.id;
  const recordId = record?.id || null;
  const ledgerParticipantIds = Array.isArray(ledger.participantIds) ? ledger.participantIds : [];
  const selectableParticipantIds = getExpenseSelectableConsumerIds(ledger, record);
  if (!editing && !selectableParticipantIds.length) {
    toast(t("noActiveLedgerParticipants"), "error");
    return;
  }

  const draft = editing ? clone(record) : {
    id: uid("record"),
    date: todayInputValue(),
    consumerId: selectableParticipantIds[0] || "",
    amount: "",
    currency: getPreferredCurrency(),
    amountCny: 0,
    rateToCny: null,
    rateSource: "live",
    splitMode: "equal",
    splitParticipantIds: selectableParticipantIds.slice(),
    splitAmountsCny: {},
    note: "",
    photo: null,
    createdAt: new Date().toISOString()
  };

  if (!editing) draft.rateToCny = getToCnyRate(draft.currency, state.rates);
  draft.splitMode = draft.splitMode === "amount" ? "amount" : "equal";
  draft.splitParticipantIds = sanitizeSplitParticipants(draft, ledgerParticipantIds);
  if (!draft.splitParticipantIds.length) draft.splitParticipantIds = selectableParticipantIds.slice();
  draft.splitAmountsCny = draft.splitAmountsCny || {};

  const consumerSelect = selectInput("consumerId", selectableParticipantIds.map((id) => ({ value: id, label: consumerName(id) })), draft.consumerId);
  const amountInput = input({ name: "amount", type: "number", step: "0.01", min: "0", value: draft.amount, required: true });
  const currencySelect = selectInput("currency", (state.config.currencies || []).map((item) => ({ value: item.code, label: `${item.code} · ${localizedName(item.name, item.code)}` })), draft.currency);
  const dateInput = input({ name: "date", type: "date", value: draft.date || todayInputValue(), required: true });
  const rateInput = input({ name: "rateToCny", type: "number", step: "0.0001", min: "0", value: formatRate(draft.rateToCny || getToCnyRate(draft.currency, state.rates)), required: true });
  const rateRefreshButton = el("button", { className: "btn ghost small", text: t("useLiveRate"), attrs: { type: "button" }, on: { click: () => fetchLiveRateForForm(true) } });
  const cnyPreview = el("strong", { text: "-" });
  const splitModeSelect = selectInput("splitMode", [
    { value: "equal", label: t("splitEqual") },
    { value: "amount", label: t("splitByAmount") }
  ], draft.splitMode);
  const splitChecks = el("div", { className: "check-grid" });
  const splitAmountBox = el("div", { className: "split-amount-box" });
  const splitTotalText = el("p", { className: "hint", text: "" });
  const noteInput = el("textarea", { className: "input", attrs: { name: "note", rows: "3", placeholder: t("note") }, text: draft.note || "" });
  const fileInput = input({ name: "photo", type: "file", accept: "image/*" });
  const preview = el("div", { className: "preview" });

  renderSplitChecks();
  renderPhotoPreview();
  updatePreview(true);
  renderSplitAmountInputs({ resetAmountDefaults: !editing || !Object.keys(draft.splitAmountsCny || {}).length });

  openModal(editing ? t("editExpense") : t("addExpense"), el("form", { className: "form", on: { submit } }, [
    field(t("date"), dateInput),
    field(t("consumer"), consumerSelect),
    field(t("amount"), amountInput),
    field(t("currency"), currencySelect),
    el("label", { className: "field" }, [
      el("span", { text: t("rateToCny") }),
      el("div", { className: "rate-editor" }, [rateInput, rateRefreshButton])
    ]),
    el("div", { className: "field inline-field" }, [el("span", { text: t("cnyValue") }), cnyPreview]),
    field(t("splitMethod"), splitModeSelect),
    field(t("splitParticipants"), splitChecks),
    splitAmountBox,
    field(t("note"), noteInput),
    field(t("choosePhoto"), fileInput),
    preview,
    modalActions()
  ]));

  let rateFetchTimer = null;
  amountInput.addEventListener("input", () => {
    updatePreview(true);
    renderSplitAmountInputs({ resetAmountDefaults: splitModeSelect.value === "amount" });
    scheduleLiveRateForForm();
  });
  currencySelect.addEventListener("change", async () => {
    await fetchLiveRateForForm(true);
    updatePreview(true);
    renderSplitAmountInputs({ resetAmountDefaults: splitModeSelect.value === "amount" });
  });
  rateInput.addEventListener("input", () => {
    draft.rateSource = "manual";
    updatePreview(true);
    renderSplitAmountInputs({ resetAmountDefaults: false });
  });
  rateInput.addEventListener("blur", () => {
    const formatted = formatRate(rateInput.value);
    if (formatted) rateInput.value = formatted;
    updatePreview(true);
    renderSplitAmountInputs({ resetAmountDefaults: false });
  });
  splitModeSelect.addEventListener("change", () => {
    draft.splitMode = splitModeSelect.value;
    renderSplitAmountInputs({ resetAmountDefaults: true });
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    draft.photo = await imageFileToDataUrl(file, state.config.app.imageMaxWidth, state.config.app.imageQuality);
    renderPhotoPreview();
    toast(t("imageTooLarge"));
  });

  if (!editing) fetchLiveRateForForm(false);

  function renderSplitChecks() {
    clear(splitChecks);
    const selected = new Set(draft.splitParticipantIds || []);
    for (const id of selectableParticipantIds) {
      const checkbox = el("input", { attrs: { type: "checkbox", value: id, checked: selected.has(id) } });
      checkbox.addEventListener("change", () => {
        draft.splitParticipantIds = Array.from(splitChecks.querySelectorAll("input:checked")).map((node) => node.value);
        renderSplitAmountInputs({ resetAmountDefaults: true });
      });
      splitChecks.append(el("label", { className: "check-pill" }, [checkbox, el("span", { text: consumerName(id) })]));
    }
  }

  function renderPhotoPreview() {
    clear(preview);
    if (!draft.photo) return;
    preview.append(
      el("button", { className: "preview-image-btn", attrs: { type: "button" }, on: { click: () => showImageViewer(draft.photo) } }, [
        el("img", { attrs: { src: draft.photo, alt: t("photo") } })
      ]),
      el("button", { className: "btn danger small", text: t("deletePhoto"), attrs: { type: "button" }, on: { click: () => { draft.photo = null; fileInput.value = ""; renderPhotoPreview(); } } })
    );
  }

  function renderSplitAmountInputs({ resetAmountDefaults = false } = {}) {
    clear(splitAmountBox);
    const total = currentAmountCny();
    const participantIds = Array.from(splitChecks.querySelectorAll("input:checked")).map((node) => node.value);
    draft.splitParticipantIds = participantIds;

    splitAmountBox.hidden = false;
    splitAmountBox.className = "split-amount-box glass-inset";

    if (splitModeSelect.value !== "amount") {
      splitAmountBox.append(splitTotalText);
      const preview = equalShareMap(total, participantIds);
      const previewText = Object.entries(preview).map(([id, value]) => `${consumerName(id)} ${money(value, "CNY")}`).join(" / ");
      splitTotalText.textContent = `${t("equalSplitPreview")}: ${previewText || "-"}`;
      return;
    }

    if (resetAmountDefaults) {
      draft.splitAmountsCny = equalShareMap(total, participantIds);
    }

    const rows = participantIds.map((id) => {
      const amount = Number(draft.splitAmountsCny?.[id] || 0);
      const amountInputForPerson = input({ name: `split_${id}`, type: "number", step: "0.01", min: "0", value: amount });
      amountInputForPerson.addEventListener("input", () => {
        draft.splitAmountsCny[id] = roundMoney(amountInputForPerson.value);
        updateSplitTotalText();
      });
      return el("label", { className: "split-amount-row" }, [
        el("span", { text: consumerName(id) }),
        amountInputForPerson
      ]);
    });

    splitAmountBox.append(
      el("div", { className: "split-amount-head" }, [
        el("strong", { text: t("splitAmountCny") }),
        el("span", { text: `${t("max")}: ${money(total, "CNY")}` })
      ]),
      ...rows,
      splitTotalText
    );
    updateSplitTotalText();
  }

  function updateSplitTotalText() {
    const total = currentAmountCny();
    const allocated = splitAmountTotal();
    const remaining = roundMoney(total - allocated);
    splitTotalText.textContent = `${t("allocated")}: ${money(allocated, "CNY")} / ${t("remaining")}: ${money(remaining, "CNY")}`;
    splitTotalText.className = Math.abs(remaining) > 0.01 ? "hint danger-text" : "hint";
  }

  function updatePreview() {
    const result = convertWithRate(amountInput.value, rateInput.value);
    cnyPreview.textContent = result.amountCny === null ? t("rateUnavailable") : money(result.amountCny, "CNY");
  }

  function currentAmountCny() {
    return convertWithRate(amountInput.value, rateInput.value).amountCny || 0;
  }

  function splitAmountTotal() {
    const participantIds = Array.from(splitChecks.querySelectorAll("input:checked")).map((node) => node.value);
    return roundMoney(participantIds.reduce((sum, id) => sum + Number(draft.splitAmountsCny?.[id] || 0), 0));
  }

  function scheduleLiveRateForForm() {
    if (rateFetchTimer) clearTimeout(rateFetchTimer);
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    rateFetchTimer = setTimeout(() => fetchLiveRateForForm(false), RATE_FETCH_DEBOUNCE_MS);
  }

  async function fetchLiveRateForForm(showToast) {
    try {
      const payload = await api.refreshRates();
      state.rates = payload.rates;
      state.lastSync = new Date().toISOString();
      const rate = getToCnyRate(currencySelect.value, state.rates);
      if (rate) {
        rateInput.value = formatRate(rate);
        draft.rateSource = state.rates?.error ? "live-error" : "live";
        updatePreview(true);
        renderSplitAmountInputs({ resetAmountDefaults: splitModeSelect.value === "amount" });
      }
      if (showToast) {
        if (state.rates?.error) toast(`${t("rateApiError")}: ${state.rates.error}`, "error");
        else toast(t("updated"), "success");
      }
    } catch (error) {
      if (showToast) toast(`${t("loadFailed")}: ${error.message}`, "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const originalAmount = Number(amountInput.value);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      toast(t("amountMustBePositive"), "error");
      return;
    }

    const result = convertWithRate(originalAmount, rateInput.value);
    if (result.amountCny === null || result.amountCny <= 0) {
      toast(t("rateUnavailable"), "error");
      return;
    }

    const splitParticipantIds = Array.from(splitChecks.querySelectorAll("input:checked")).map((node) => node.value);
    if (!splitParticipantIds.length) {
      toast(t("emptySplitParticipants"), "error");
      return;
    }

    let splitAmountsCny = {};
    if (splitModeSelect.value === "amount") {
      splitAmountsCny = Object.fromEntries(splitParticipantIds.map((id) => [id, roundMoney(draft.splitAmountsCny?.[id] || 0)]));
      const allocated = roundMoney(Object.values(splitAmountsCny).reduce((sum, value) => sum + Number(value || 0), 0));
      if (allocated > result.amountCny + 0.01) {
        toast(t("splitAmountTooHigh"), "error");
        return;
      }
      if (allocated < result.amountCny - 0.01) {
        toast(t("splitAmountIncomplete"), "error");
        return;
      }
    }

    const now = new Date().toISOString();
    const next = {
      ...draft,
      type: "expense",
      date: dateInput.value,
      consumerId: consumerSelect.value,
      amount: originalAmount,
      currency: currencySelect.value,
      amountCny: result.amountCny,
      rateToCny: normalizeRate(rateInput.value),
      rateSource: draft.rateSource || "manual",
      splitMode: splitModeSelect.value,
      splitParticipantIds: splitParticipantIds.slice(),
      splitAmountsCny,
      note: noteInput.value.trim(),
      createdAt: draft.createdAt || now,
      updatedAt: now
    };

    const saved = await commitDataMutation((nextData) => {
      const targetLedger = nextData.ledgers.find((item) => item.id === ledgerId);
      if (!targetLedger) throw new Error(t("ledgerNotFound"));
      targetLedger.records = Array.isArray(targetLedger.records) ? targetLedger.records : [];

      if (editing) {
        const targetRecord = targetLedger.records.find((item) => item.id === recordId && !item.deleted);
        if (!targetRecord) throw new Error(t("recordNotFound"));
        const updatedRecord = {
          ...clone(next),
          createdAt: targetRecord.createdAt || next.createdAt,
          history: Array.isArray(targetRecord.history) ? targetRecord.history.slice() : []
        };
        appendRecordHistory(updatedRecord, "updated", `${t("before")}: ${expenseHistorySummary(targetRecord)} → ${t("after")}: ${expenseHistorySummary(updatedRecord)}`, now);
        Object.assign(targetRecord, updatedRecord);
      } else {
        const createdRecord = {
          ...clone(next),
          history: []
        };
        createdRecord.id = allocateEntityId("record", targetLedger.records, createdRecord.id);
        appendRecordHistory(createdRecord, "created", expenseHistorySummary(createdRecord), now);
        targetLedger.records.unshift(createdRecord);
      }
      targetLedger.updatedAt = now;
    });

    if (!saved) return;
    savePreferredCurrency(next.currency);
    closeModal();
  }
}

async function showConsumerModal(consumer = null) {
  const requestedConsumerId = consumer?.id || null;
  try {
    await ensureFullDataForMutation();
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return;
  }

  consumer = requestedConsumerId ? (state.config.consumers || []).find((item) => item.id === requestedConsumerId) : null;
  if (requestedConsumerId && !consumer) {
    toast(t("consumerNotFound"), "error");
    return;
  }

  const editing = Boolean(consumer);
  const consumerId = consumer?.id || null;
  const draft = editing ? clone(consumer) : { id: uid("consumer"), name: { "zh-CN": "", "en-US": "" }, active: true };
  const zhInput = input({ name: "zh", value: draft.name?.["zh-CN"] || "", required: true });
  const enInput = input({ name: "en", value: draft.name?.["en-US"] || "" });
  const activeInput = el("input", { attrs: { type: "checkbox", checked: draft.active !== false } });

  openModal(editing ? t("edit") : t("addConsumer"), el("form", { className: "form", on: { submit } }, [
    field(t("consumerNameZh"), zhInput),
    field(t("consumerNameEn"), enInput),
    el("label", { className: "check-pill single" }, [activeInput, el("span", { text: t("active") })]),
    modalActions()
  ]));

  async function submit(event) {
    event.preventDefault();
    const zhName = zhInput.value.trim();
    const enName = enInput.value.trim() || zhName;
    if (!zhName) return;

    const saved = await commitConfigMutation((nextConfig) => {
      nextConfig.consumers = Array.isArray(nextConfig.consumers) ? nextConfig.consumers : [];
      if (editing) {
        const target = nextConfig.consumers.find((item) => item.id === consumerId);
        if (!target) throw new Error(t("consumerNotFound"));
        target.name = { "zh-CN": zhName, "en-US": enName };
        target.active = activeInput.checked;
      } else {
        nextConfig.consumers.push({
          ...clone(draft),
          name: { "zh-CN": zhName, "en-US": enName },
          active: activeInput.checked
        });
      }
    });

    if (!saved) return;
    closeModal();
  }
}

function input({ name, type = "text", value = "", required = false, ...rest }) {
  return el("input", { className: "input", attrs: { name, type, value, required, ...rest } });
}

function selectInput(name, options, selected) {
  const select = el("select", { className: "select", attrs: { name, required: true } });
  for (const option of options) {
    select.append(el("option", { text: option.label, attrs: { value: option.value, selected: option.value === selected } }));
  }
  return select;
}

function field(label, control) {
  return el("label", { className: "field" }, [el("span", { text: label }), control]);
}

function modalActions() {
  return el("div", { className: "modal-actions" }, [
    el("button", { className: "btn ghost", text: t("cancel"), attrs: { type: "button" }, on: { click: closeModal } }),
    el("button", { className: "btn primary", text: t("save"), attrs: { type: "submit" } })
  ]);
}

function openModal(title, body, modalClassName = "") {
  clear(modalRoot);
  modalRoot.append(el("div", { className: "modal-backdrop", on: { click: (event) => { if (event.target.classList.contains("modal-backdrop")) closeModal(); } } }, [
    el("section", { className: `modal glass ${modalClassName}`.trim() }, [
      el("div", { className: "modal-head" }, [
        el("h2", { text: title }),
        el("button", { className: "btn ghost small", text: "×", attrs: { type: "button", "aria-label": t("close") }, on: { click: closeModal } })
      ]),
      body
    ])
  ]));
}

function closeModal() {
  clear(modalRoot);
}

function showImageViewer(src) {
  const root = el("div", { className: "image-viewer-backdrop", on: { click: (event) => { if (event.target.classList.contains("image-viewer-backdrop")) root.remove(); } } }, [
    el("div", { className: "image-viewer glass" }, [
      el("button", { className: "btn ghost small image-viewer-close", text: "×", attrs: { type: "button", "aria-label": t("close") }, on: { click: () => root.remove() } }),
      el("img", { attrs: { src, alt: t("photo") } })
    ])
  ]);
  document.body.append(root);
}

async function showSettlementModal(ledger) {
  const ledgerId = ledger?.id;
  try {
    await ensureFullDataForMutation();
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
    return;
  }

  ledger = getLedger(ledgerId);
  if (!ledger) {
    toast(t("ledgerNotFound"), "error");
    return;
  }

  const currentSummary = ledgerSummary(ledger, state.config);
  const settlements = currentSummary.settlements || [];
  const historyRecords = (currentSummary.settlementRecords || [])
    .slice()
    .sort((a, b) => recordSortTime(b).localeCompare(recordSortTime(a)));
  const total = roundMoney(settlements.reduce((sum, item) => sum + Number(item.amount || 0), 0));

  const body = el("div", { className: "settlement-modal-body" }, [
    el("section", { className: "settlement-modal-section current" }, [
      el("div", { className: "settlement-modal-title" }, [
        el("div", { className: "settlement-modal-title-main" }, [
          el("h3", { text: t("currentSettlementAdvice") }),
          el("p", { className: "settlement-modal-hint", text: t("settlementModalHint") })
        ]),
        el("span", { className: settlements.length ? "pill" : "pill success", text: settlements.length ? money(total, "CNY") : t("settlementClearShort") })
      ]),
      settlements.length
        ? el("div", { className: "settlement-list modal-settlement-list" }, settlements.map((item) => renderSettlementAdviceItem(item, currentSummary)))
        : el("p", { className: "muted settlement-empty", text: t("settlementClear") })
    ]),
    el("section", { className: "settlement-modal-section history" }, [
      el("div", { className: "settlement-modal-title" }, [
        el("div", { className: "settlement-modal-title-main" }, [
          el("h3", { text: t("settlementHistory") }),
          el("p", { className: "settlement-modal-hint" , text: t("settlementHistoryHint") })
        ]),
        el("span", { className: "pill", text: String(historyRecords.length) })
      ]),
      historyRecords.length
        ? el("div", { className: "settlement-history-list" }, historyRecords.map(renderSettlementHistoryItem))
        : el("p", { className: "muted settlement-empty", text: t("noSettlementHistory") })
    ]),
    el("div", { className: "modal-actions settlement-modal-actions" }, [
      el("button", { className: "btn ghost", text: t("cancel"), attrs: { type: "button" }, on: { click: closeModal } }),
      el("button", {
        className: "btn settle",
        text: t("settleNow"),
        attrs: { type: "button", disabled: settlements.length ? false : true },
        on: { click: () => createSettlementRecords(ledger.id) }
      })
    ])
  ]);

  openModal(t("settlement"), body, "settlement-modal-shell");
}

function renderSettlementAdviceItem(item, summary) {
  const nameMap = Object.fromEntries((summary.participants || []).map((p) => [p.id, localizedName(p.name, p.id)]));
  const from = nameMap[item.fromId] || item.fromId;
  const to = nameMap[item.toId] || item.toId;
  return el("div", { className: "settlement-item enhanced modal-settlement-item" }, [
    el("div", { className: "settlement-route compact" }, [
      el("span", { className: "person-chip debtor", text: from }),
      el("span", { className: "route-arrow-word", text: t("payAmount") }),
      el("span", { className: "person-chip creditor", text: to })
    ]),
    el("div", { className: "settlement-transfer-card" }, [
      el("div", { className: "settlement-transfer-label", text: t("settlementInstruction", { from, to, amount: money(item.amount, "CNY") }) }),
      el("div", { className: "settlement-amount hero" }, [
        el("small", { text: t("payAmount") }),
        el("strong", { text: money(item.amount, "CNY") })
      ])
    ])
  ]);
}

function renderSettlementHistoryItem(record) {
  const from = consumerName(record.fromConsumerId);
  const to = consumerName(record.toConsumerId);
  const amount = roundMoney(record.amountCny || record.amount || 0);
  return el("div", { className: "settlement-history-item" }, [
    el("div", { className: "settlement-history-main" }, [
      el("strong", { text: t("settlementRecordText", { from, to, amount: money(amount, "CNY") }) }),
      el("small", { text: formatDateTime(record.createdAt || record.updatedAt || record.date) })
    ]),
    el("span", { className: "settlement-history-amount", text: money(amount, "CNY") })
  ]);
}

async function toggleArchive(ledgerId) {
  await commitDataMutation((nextData) => {
    const ledger = nextData.ledgers.find((item) => item.id === ledgerId);
    if (!ledger) throw new Error(t("ledgerNotFound"));
    ledger.archived = !ledger.archived;
    ledger.updatedAt = new Date().toISOString();
  });
}

async function createSettlementRecords(ledgerOrId) {
  const ledgerId = typeof ledgerOrId === "string" ? ledgerOrId : ledgerOrId?.id;
  if (!ledgerId) return;

  let createdCount = 0;
  const saved = await commitDataMutation((nextData) => {
    const ledger = nextData.ledgers.find((item) => item.id === ledgerId);
    if (!ledger) throw new Error(t("ledgerNotFound"));

    const settlements = ledgerSummary(ledger, state.config).settlements || [];
    if (!settlements.length) return false;

    const total = roundMoney(settlements.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    if (!confirm(t("confirmSettle", { count: settlements.length, amount: money(total, "CNY") }))) return false;

    const now = new Date().toISOString();
    const batchId = uid("settle_batch");
    ledger.records = Array.isArray(ledger.records) ? ledger.records : [];

    const reservedRecords = ledger.records.slice();
    const records = settlements.map((item) => {
      const record = {
        id: allocateEntityId("settlement", reservedRecords),
        type: "settlement",
        date: todayInputValue(),
        fromConsumerId: item.fromId,
        toConsumerId: item.toId,
        amount: roundMoney(item.amount),
        currency: "CNY",
        amountCny: roundMoney(item.amount),
        rateToCny: 1,
        rateSource: "settlement",
        settlementBatchId: batchId,
        note: "",
        createdAt: now,
        updatedAt: now,
        history: []
      };
      appendRecordHistory(record, "created", expenseHistorySummary(record), now);
      reservedRecords.push(record);
      return record;
    });

    ledger.records.unshift(...records);
    ledger.updatedAt = now;
    createdCount = records.length;
  });

  if (!saved) return;
  closeModal();
  toast(t("settlementSaved", { count: createdCount }), "success");
}

async function deleteArchivedLedger(ledgerId) {
  const saved = await commitDataMutation((nextData) => {
    const ledger = nextData.ledgers.find((item) => item.id === ledgerId);
    if (!ledger || !ledger.archived) throw new Error(t("ledgerNotFound"));

    const records = Array.isArray(ledger.records) ? ledger.records : [];
    const activeRecordCount = records.filter((record) => !record.deleted).length;
    const deletedRecordCount = records.length - activeRecordCount;
    if (!confirm(t("confirmDeleteArchivedLedger", {
      name: ledger.name || ledgerId,
      active: activeRecordCount,
      deleted: deletedRecordCount
    }))) return false;

    nextData.ledgers = nextData.ledgers.filter((item) => item.id !== ledgerId);
  }, { render: false });

  if (!saved) return;
  clearLastOpenedLedgerId(ledgerId);

  if (state.selectedLedgerId === ledgerId) {
    const fallbackLedger = getDefaultLedger();
    state.view = fallbackLedger ? "ledger" : "dashboard";
    state.selectedLedgerId = fallbackLedger?.id || null;
    if (fallbackLedger) saveLastOpenedLedgerId(fallbackLedger.id);
  }

  renderShell();
  renderApp();
}

async function deleteRecord(ledgerId, recordId) {
  await commitDataMutation((nextData) => {
    const ledger = nextData.ledgers.find((item) => item.id === ledgerId);
    const record = ledger?.records?.find((item) => item.id === recordId && !item.deleted);
    if (!ledger || !record) throw new Error(t("recordNotFound"));

    const hasActiveSettlements = ledger.records.some((item) => !item.deleted && isSettlementRecord(item));
    const confirmKey = isSettlementRecord(record)
      ? "confirmDeleteSettlement"
      : (hasActiveSettlements ? "confirmDeleteExpenseWithSettlement" : "confirmDeleteExpense");
    if (!confirm(t(confirmKey))) return false;

    const now = new Date().toISOString();
    record.deleted = true;
    record.deletedAt = now;
    record.updatedAt = now;
    appendRecordHistory(record, "deleted", expenseHistorySummary(record), now);
    ledger.updatedAt = now;
  });
}

async function handleConsumerRemoval(consumerId) {
  await commitConfigMutation((nextConfig) => {
    nextConfig.consumers = Array.isArray(nextConfig.consumers) ? nextConfig.consumers : [];
    const consumer = nextConfig.consumers.find((item) => item.id === consumerId);
    if (!consumer) throw new Error(t("consumerNotFound"));

    const usage = consumerUsage(state.data, consumerId);
    const isReferenced = usage.ledgerCount > 0 || usage.recordCount > 0;
    if (isReferenced) {
      if (!confirm(t("confirmDeactivateConsumer", { ledgers: usage.ledgerCount, records: usage.recordCount }))) return false;
      consumer.active = false;
      return;
    }

    if (!confirm(t("confirmDeleteUnusedConsumer"))) return false;
    nextConfig.consumers = nextConfig.consumers.filter((item) => item.id !== consumerId);
  });
}

async function refreshData() {
  if (state.saving) {
    toast(t("operationInProgress"), "error");
    return;
  }

  const previousView = state.view;
  const previousLedgerId = state.selectedLedgerId;
  try {
    toast(t("refreshingData"));
    const payload = await api.bootstrap();
    setBootstrap(payload);
    state.view = previousView;
    state.selectedLedgerId = previousLedgerId;
    if (state.view === "ledger" && (!previousLedgerId || !getLedger(previousLedgerId))) {
      const fallbackLedger = getDefaultLedger();
      state.view = fallbackLedger ? "ledger" : "dashboard";
      state.selectedLedgerId = fallbackLedger?.id || null;
    }
    renderShell();
    renderApp();
    toast(t("updated"), "success");
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
  }
}

async function refreshRates() {
  try {
    const payload = await api.refreshRates();
    state.rates = payload.rates;
    state.lastSync = new Date().toISOString();
    renderApp();
    if (state.rates?.error) {
      toast(`${t("rateApiError")}: ${state.rates.error}`, "error");
      return;
    }
    toast(t("updated"), "success");
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
  }
}

function getExpenseSelectableConsumerIds(ledger, record = null) {
  const result = [];
  const seen = new Set();
  const add = (id, allowInactive = false) => {
    const value = String(id || "").trim();
    if (!value || seen.has(value)) return;
    const consumer = (state.config.consumers || []).find((item) => item.id === value);
    if (!allowInactive && (!consumer || consumer.active === false)) return;
    seen.add(value);
    result.push(value);
  };

  for (const id of ledger?.participantIds || []) add(id, false);

  if (record) {
    add(record.consumerId, true);
    for (const id of sanitizeSplitParticipants(record, ledger?.participantIds || [])) add(id, true);
  }

  return result;
}

function materializeLegacySplitSnapshots(ledger) {
  const fallbackIds = Array.from(new Set((ledger.participantIds || []).filter(Boolean)));
  for (const record of ledger.records || []) {
    if (isSettlementRecord(record)) continue;
    if (Array.isArray(record.splitParticipantIds) && record.splitParticipantIds.length) continue;

    const amountIds = record.splitMode === "amount" ? Object.keys(record.splitAmountsCny || {}).filter(Boolean) : [];
    record.splitParticipantIds = (amountIds.length ? amountIds : fallbackIds).slice();
  }
}

async function ensureFullDataForMutation() {
  if (clientConfigPromise) {
    await clientConfigPromise;
  }

  if (!state.remoteReady && remoteLoadPromise) {
    await remoteLoadPromise;
  }

  if (state.remoteReady) return true;
  throw new Error(t("dataStillLoading"));
}

async function commitDataMutation(mutator, { render = true } = {}) {
  if (state.saving) {
    toast(t("operationInProgress"), "error");
    return false;
  }

  state.saving = true;
  try {
    await ensureFullDataForMutation();
    const nextData = clone(state.data);
    const mutationResult = await mutator(nextData);
    if (mutationResult === false) return false;

    const payload = await api.saveData(nextData, state.dataSha);
    nextData.updatedAt = payload.updatedAt || new Date().toISOString();
    state.data = nextData;
    state.dataSha = payload.sha;
    state.lastSync = nextData.updatedAt;
    state.remoteReady = true;
    if (render) renderApp();
    toast(t("saved"), "success");
    return true;
  } catch (error) {
    const message = error.code === "GITHUB_CONFLICT" ? t("conflict") : `${t("saveFailed")}: ${error.message}`;
    toast(message, "error");
    return false;
  } finally {
    state.saving = false;
  }
}

async function commitConfigMutation(mutator, { render = true } = {}) {
  if (state.saving) {
    toast(t("operationInProgress"), "error");
    return false;
  }

  state.saving = true;
  try {
    await ensureFullDataForMutation();
    const nextConfig = clone(state.config);
    const mutationResult = await mutator(nextConfig);
    if (mutationResult === false) return false;

    const payload = await api.saveConfig(nextConfig, state.configSha);
    state.config = nextConfig;
    state.configSha = payload.sha;
    state.lastSync = payload.updatedAt || new Date().toISOString();
    state.remoteReady = true;
    if (render) renderApp();
    toast(t("saved"), "success");
    return true;
  } catch (error) {
    const message = error.code === "GITHUB_CONFLICT" ? t("conflict") : `${t("saveFailed")}: ${error.message}`;
    toast(message, "error");
    return false;
  } finally {
    state.saving = false;
  }
}

function toast(message, type = "info") {
  // V0.7.6: suppress routine floating prompts after save/refresh/settlement.
  // Keep error prompts so failures are still visible.
  if (type !== "error") return;
  const item = el("div", { className: `toast ${type}`, text: message });
  toastBox.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function consumerName(id) {
  const consumer = state.config.consumers.find((item) => item.id === id);
  return localizedName(consumer?.name, id);
}

function preventMobilePageZoom() {
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  });
}

function bindNetworkEvents() {
  window.addEventListener("offline", () => toast(t("offline"), "error"));
  window.addEventListener("online", () => toast(t("online"), "success"));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && state.ready && !state.saving) void refreshData();
  });
}

function maybeShowIosInstallTip() {
  if (!isIosSafari() || isStandalonePwa()) return;
  if (localStorage.getItem("syncSpend.installTipClosed") === "1") return;
  const banner = el("div", { className: "install-tip glass" }, [
    el("div", {}, [el("strong", { text: t("installTipTitle") }), el("p", { text: t("installTip") })]),
    el("button", { className: "btn ghost small", text: t("close"), on: { click: () => { localStorage.setItem("syncSpend.installTipClosed", "1"); banner.remove(); } } })
  ]);
  document.body.append(banner);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    const swUrl = new URL("../../service-worker.js", import.meta.url);
    const swScope = new URL("../../", import.meta.url).pathname;
    navigator.serviceWorker.register(swUrl, { scope: swScope, updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}
