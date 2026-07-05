import { ApiClient, getSavedPassword, loadClientConfig } from "./api.js";
import { equalShareMap, ledgerSummary, recordShareMap, sanitizeSplitParticipants } from "./calculator.js";
import { convertWithRate, formatRate, getToCnyRate, normalizeRate, roundMoney } from "./currency.js";
import { getLanguage, LANGS, localizedName, setLanguage, t } from "./i18n.js";
import { activeConsumers, getLedger, loadCache, setBootstrap, state, updateCache } from "./store.js";
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

const APP_VERSION = "0.6.2";
const LAST_CURRENCY_KEY = "syncSpend.lastCurrency";
const LAST_LEDGER_KEY = "syncSpend.lastLedgerId";
const RATE_FETCH_DEBOUNCE_MS = 500;

const api = new ApiClient();
const app = document.querySelector("#app");
const toastBox = document.querySelector("#toast");
const modalRoot = document.querySelector("#modal-root");

setLanguage(localStorage.getItem("syncSpend.lang") || "zh-CN");
init();

async function init() {
  bindNetworkEvents();
  registerServiceWorker();
  renderShell();

  const clientConfig = await loadClientConfig();
  api.applyClientConfig(clientConfig);

  const hasCache = loadCache();
  if (hasCache) {
    restoreLastOpenedLedger();
    renderApp();
  }

  const password = getSavedPassword();
  if (!password) {
    renderLogin();
    maybeShowIosInstallTip();
    return;
  }

  await loadRemote();
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
    el("header", { className: "topbar glass" }, [
      el("button", { className: "brand", on: { click: () => navigate("dashboard") } }, [
        el("img", { attrs: { src: new URL("../../assets/icons/icon-192.png", import.meta.url).toString(), alt: "" } }),
        el("span", { className: "brand-title" }, [
          el("span", { text: getAppTitle() }),
          el("small", { className: "version-badge", text: `v${getAppVersion()}` })
        ])
      ]),
      el("nav", { className: "top-actions" }, [
        navButton("dashboard", t("dashboard")),
        navButton("settings", t("settings")),
        languageSelect()
      ])
    ]),
    el("main", { className: "main", attrs: { id: "main" } })
  );
}

function getAppTitle() {
  return localizedName(state.config?.app?.name, t("appName")) || t("appName");
}

function getAppVersion() {
  return String(state.config?.app?.version || APP_VERSION).replace(/^v/i, "");
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

function renderLogin() {
  renderShell();
  const main = document.querySelector("#main");
  clear(main);
  main.append(
    el("section", { className: "login-card glass" }, [
      el("div", { className: "login-icon", text: "¥" }),
      el("h1", { text: t("loginTitle") }),
      el("p", { className: "muted", text: t("loginDesc") }),
      el("form", { className: "form", on: { submit: submitLogin } }, [
        el("label", { className: "field" }, [
          el("span", { text: t("password") }),
          el("input", { attrs: { type: "password", name: "password", autocomplete: "current-password", required: true } })
        ]),
        el("button", { className: "btn primary wide", text: t("enter"), attrs: { type: "submit" } })
      ])
    ])
  );
}

async function submitLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get("password") || "").trim();
  if (!password) return;
  api.setPassword(password);
  await loadRemote();
}

async function loadRemote() {
  state.loading = true;
  renderLoading();
  try {
    const payload = await api.bootstrap();
    setBootstrap(payload);
    restoreLastOpenedLedger();
    renderShell();
    renderApp();
  } catch (error) {
    if (!state.ready) renderLogin();
    toast(`${t("loadFailed")}: ${error.message}`, "error");
  } finally {
    state.loading = false;
  }
}

function renderLoading() {
  const main = document.querySelector("#main");
  if (!main) return;
  clear(main);
  main.append(el("section", { className: "glass center-card" }, [
    el("div", { className: "loader" }),
    el("p", { className: "muted", text: "Loading..." })
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
    state.view = "dashboard";
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

function restoreLastOpenedLedger() {
  const ledgerId = getLastOpenedLedgerId();
  if (ledgerId && getLedger(ledgerId)) {
    state.view = "ledger";
    state.selectedLedgerId = ledgerId;
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
    renderRatesCard({ collapsed: true }),
    renderLedgerList(t("activeLedgers"), active, false),
    renderLedgerList(t("archivedLedgers"), archived, true)
  );
  return section;
}

function renderRatesCard({ collapsed = false } = {}) {
  const rows = (state.config.currencies || []).map((currency) => {
    const rate = getToCnyRate(currency.code, state.rates, state.config);
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
      el("span", { className: "pill", text: state.rates?.fallback ? "manual" : state.rates?.provider || "-" })
    ]),
    el("div", { className: "collapsible-body" }, [
      ...rows,
      el("p", { className: "hint", text: t("rateTip") })
    ])
  ]);
}

function renderLedgerList(title, ledgers, archived) {
  const list = el("section", { className: "glass card ledger-section" }, [
    el("div", { className: "card-head" }, [
      el("h2", { text: title }),
      el("span", { className: "pill", text: String(ledgers.length) })
    ])
  ]);

  if (!ledgers.length) {
    list.append(el("p", { className: "muted", text: archived ? "-" : t("noLedger") }));
    return list;
  }

  const grid = el("div", { className: "ledger-grid" });
  for (const ledger of ledgers) grid.append(renderLedgerCard(ledger));
  list.append(grid);
  return list;
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
      el("button", { className: "btn ghost small", text: ledger.archived ? t("unarchive") : t("archive"), on: { click: () => toggleArchive(ledger.id) } })
    ])
  ]);
}

function metric(label, value) {
  return el("div", { className: "metric" }, [el("span", { text: label }), el("strong", { text: value })]);
}

function renderLedgerDetail(ledger) {
  const summary = ledgerSummary(ledger, state.config);
  return el("section", { className: "ledger-detail" }, [
    el("div", { className: "hero glass" }, [
      el("div", {}, [
        el("button", { className: "btn ghost small", text: `← ${t("back")}`, on: { click: () => navigate("dashboard") } }),
        el("h1", { text: ledger.name }),
        el("p", { className: "muted", text: `${t("createdAt")}: ${formatDateTime(ledger.createdAt)}` })
      ]),
      el("div", { className: "hero-actions" }, [
        el("button", { className: "btn primary", text: t("addExpense"), on: { click: () => showExpenseModal(ledger) } }),
        el("button", { className: "btn ghost", text: t("edit"), on: { click: () => showLedgerModal(ledger) } }),
        el("button", { className: "btn ghost", text: ledger.archived ? t("unarchive") : t("archive"), on: { click: () => toggleArchive(ledger.id) } })
      ])
    ]),
    el("div", { className: "summary-grid" }, [
      el("article", { className: "glass card" }, [
        el("h2", { text: t("total") }),
        el("div", { className: "big-number", text: money(summary.totalCny, "CNY") }),
        el("p", { className: "muted", text: `${t("perPerson")}: ${money(summary.perPerson, "CNY")}` }),
        summary.unallocatedCny > 0.01 ? el("p", { className: "hint warn", text: `${t("unallocated")}: ${money(summary.unallocatedCny, "CNY")}` }) : null
      ]),
      renderBalances(summary),
      renderSettlements(summary)
    ]),
    renderRecords(ledger, summary.records)
  ]);
}

function renderBalances(summary) {
  const rows = summary.balances.map((item) => el("tr", {}, [
    el("td", { text: localizedName(item.consumer.name, item.consumerId) }),
    el("td", { text: money(item.paid, "CNY") }),
    el("td", { text: money(item.share, "CNY") }),
    el("td", { className: item.balance >= 0 ? "pos" : "neg", text: money(item.balance, "CNY") })
  ]));

  return el("article", { className: "glass card wide" }, [
    el("h2", { text: t("balance") }),
    el("div", { className: "table-wrap" }, [
      el("table", { className: "table" }, [
        el("thead", {}, el("tr", {}, [
          el("th", { text: t("consumer") }),
          el("th", { text: t("paid") }),
          el("th", { text: t("shareAmount") }),
          el("th", { text: t("net") })
        ])),
        el("tbody", {}, rows)
      ])
    ])
  ]);
}

function renderSettlements(summary) {
  const nameMap = Object.fromEntries(summary.participants.map((p) => [p.id, localizedName(p.name, p.id)]));
  return el("article", { className: "glass card" }, [
    el("h2", { text: t("settlement") }),
    summary.settlements.length
      ? el("div", { className: "settlement-list" }, summary.settlements.map((item) => el("div", { className: "settlement-item" }, [
        el("span", { text: `${nameMap[item.fromId] || item.fromId} → ${nameMap[item.toId] || item.toId}` }),
        el("strong", { text: money(item.amount, "CNY") })
      ])))
      : el("p", { className: "muted", text: t("noSettlement") })
  ]);
}

function renderRecords(ledger, records) {
  const card = el("article", { className: "glass card" }, [
    el("div", { className: "card-head" }, [el("h2", { text: t("records") }), el("span", { className: "pill", text: String(records.length) })])
  ]);

  if (!records.length) {
    card.append(el("p", { className: "muted", text: t("noRecord") }));
    return card;
  }

  const list = el("div", { className: "record-list" });
  for (const record of records.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const payer = state.config.consumers.find((item) => item.id === record.consumerId);
    const shareMap = recordShareMap(record, ledger.participantIds);
    const shareText = Object.entries(shareMap)
      .map(([id, value]) => `${consumerName(id)} ${money(value, "CNY")}`)
      .join(" / ");

    list.append(el("div", { className: "record-item liquid-card" }, [
      record.photo ? photoThumb(record.photo) : el("div", { className: "record-photo placeholder", text: "📷" }),
      el("div", { className: "record-body" }, [
        el("div", { className: "record-title" }, [
          el("strong", { text: money(record.amount, record.currency) }),
          el("span", { text: `${t("cnyValue")}: ${money(record.amountCny, "CNY")}` })
        ]),
        el("p", { className: "muted", text: `${formatDate(record.date)} · ${localizedName(payer?.name, record.consumerId)} · ${t("rate")}: ${formatRate(record.rateToCny) || "-"}` }),
        el("p", { className: "muted", text: `${t("splitMethod")}: ${record.splitMode === "amount" ? t("splitByAmount") : t("splitEqual")}` }),
        shareText ? el("p", { className: "record-shares", text: shareText }) : null,
        record.note ? el("p", { text: record.note }) : null
      ]),
      el("div", { className: "row-actions vertical" }, [
        el("button", { className: "btn ghost small", text: t("edit"), on: { click: () => showExpenseModal(ledger, record) } }),
        el("button", { className: "btn danger small", text: t("delete"), on: { click: () => deleteRecord(ledger.id, record.id) } })
      ])
    ]));
  }
  card.append(list);
  return card;
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
    list.append(el("div", { className: "consumer-item liquid-card" }, [
      el("div", {}, [el("strong", { text: localizedName(consumer.name, consumer.id) }), el("p", { className: "muted", text: consumer.active === false ? t("inactive") : t("active") })]),
      el("div", { className: "row-actions" }, [
        el("button", { className: "btn ghost small", text: t("edit"), on: { click: () => showConsumerModal(consumer) } }),
        el("button", { className: "btn danger small", text: t("delete"), on: { click: () => deleteConsumer(consumer.id) } })
      ])
    ]));
  }
  return el("article", { className: "glass card" }, [
    el("div", { className: "card-head" }, [el("h2", { text: t("consumers") }), el("span", { className: "pill", text: String((state.config.consumers || []).length) })]),
    list
  ]);
}

function renderConfigInfo() {
  const cf = state.config.cloudflare || {};
  const rows = {
    workerUrl: cf.workerUrl || cf.apiBaseUrl || "",
    accessPassword: cf.accessPassword ? "******" : "",
    projectName: cf.projectName || "sync-spend"
  };
  return el("article", { className: "glass card" }, [
    el("h2", { text: "Cloudflare / GitHub" }),
    el("p", { className: "muted", text: "GitHub Token、仓库信息等运行变量放在 Cloudflare。config.json 只保存前端要连接的 Worker 地址和访问密码。" }),
    el("div", { className: "kv-list" }, Object.entries(rows).map(([key, value]) => el("div", {}, [el("span", { text: key }), el("strong", { text: String(value || "-") })]))),
    renderRatesCard({ collapsed: false })
  ]);
}

function showLedgerModal(ledger = null) {
  const editing = Boolean(ledger);
  const draft = editing ? clone(ledger) : {
    id: uid("ledger"),
    name: "",
    archived: false,
    participantIds: activeConsumers().map((consumer) => consumer.id),
    records: [],
    createdAt: new Date().toISOString()
  };

  const nameInput = input({ name: "name", value: draft.name, required: true });
  const checks = el("div", { className: "check-grid" });
  for (const consumer of activeConsumers()) {
    const checkbox = el("input", { attrs: { type: "checkbox", value: consumer.id, checked: draft.participantIds.includes(consumer.id) } });
    checks.append(el("label", { className: "check-pill" }, [checkbox, el("span", { text: localizedName(consumer.name, consumer.id) })]));
  }

  openModal(editing ? t("edit") : t("createLedger"), el("form", { className: "form", on: { submit } }, [
    field(t("ledgerName"), nameInput),
    field(t("participants"), checks),
    modalActions()
  ]));

  async function submit(event) {
    event.preventDefault();
    const participantIds = Array.from(checks.querySelectorAll("input:checked")).map((node) => node.value);
    if (!participantIds.length) {
      toast(t("emptyParticipants"), "error");
      return;
    }
    draft.name = nameInput.value.trim();
    draft.participantIds = participantIds;
    if (!draft.name) return;

    if (editing) Object.assign(ledger, draft, { updatedAt: new Date().toISOString() });
    else state.data.ledgers.unshift(draft);

    await saveDataAndRender();
    closeModal();
    if (!editing) navigate("ledger", draft.id);
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

function showExpenseModal(ledger, record = null) {
  const editing = Boolean(record);
  const ledgerParticipantIds = Array.isArray(ledger.participantIds) ? ledger.participantIds : [];
  const draft = editing ? clone(record) : {
    id: uid("record"),
    date: todayInputValue(),
    consumerId: ledgerParticipantIds[0] || activeConsumers()[0]?.id || "",
    amount: "",
    currency: getPreferredCurrency(),
    amountCny: 0,
    rateToCny: 1,
    rateSource: "live",
    splitMode: "equal",
    splitParticipantIds: ledgerParticipantIds.slice(),
    splitAmountsCny: {},
    note: "",
    photo: null,
    createdAt: new Date().toISOString()
  };

  if (!editing) draft.rateToCny = getToCnyRate(draft.currency, state.rates, state.config) || 1;
  draft.splitMode = draft.splitMode === "amount" ? "amount" : "equal";
  draft.splitParticipantIds = sanitizeSplitParticipants(draft, ledgerParticipantIds);
  if (!draft.splitParticipantIds.length) draft.splitParticipantIds = ledgerParticipantIds.slice();
  draft.splitAmountsCny = draft.splitAmountsCny || {};

  const consumerSelect = selectInput("consumerId", ledgerParticipantIds.map((id) => ({ value: id, label: consumerName(id) })), draft.consumerId);
  const amountInput = input({ name: "amount", type: "number", step: "0.01", min: "0", value: draft.amount, required: true });
  const currencySelect = selectInput("currency", (state.config.currencies || []).map((item) => ({ value: item.code, label: `${item.code} · ${localizedName(item.name, item.code)}` })), draft.currency);
  const dateInput = input({ name: "date", type: "date", value: draft.date || todayInputValue(), required: true });
  const rateInput = input({ name: "rateToCny", type: "number", step: "0.0001", min: "0", value: formatRate(draft.rateToCny || getToCnyRate(draft.currency, state.rates, state.config) || 1), required: true });
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
    for (const id of ledgerParticipantIds) {
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
    splitTotalText.className = allocated > total + 0.01 ? "hint danger-text" : "hint";
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
      updateCache();
      const rate = getToCnyRate(currencySelect.value, state.rates, state.config);
      if (rate) {
        rateInput.value = formatRate(rate);
        draft.rateSource = state.rates?.fallback ? "fallback" : "live";
        updatePreview(true);
        renderSplitAmountInputs({ resetAmountDefaults: splitModeSelect.value === "amount" });
      }
      if (showToast) toast(t("updated"), "success");
    } catch (error) {
      if (showToast) toast(`${t("loadFailed")}: ${error.message}`, "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const result = convertWithRate(amountInput.value, rateInput.value);
    if (result.amountCny === null) {
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
    }

    const next = {
      ...draft,
      date: dateInput.value,
      consumerId: consumerSelect.value,
      amount: Number(amountInput.value),
      currency: currencySelect.value,
      amountCny: result.amountCny,
      rateToCny: normalizeRate(rateInput.value),
      rateSource: draft.rateSource || "manual",
      splitMode: splitModeSelect.value,
      splitParticipantIds,
      splitAmountsCny,
      note: noteInput.value.trim(),
      updatedAt: new Date().toISOString()
    };

    if (editing) Object.assign(record, next);
    else {
      savePreferredCurrency(next.currency);
      ledger.records = Array.isArray(ledger.records) ? ledger.records : [];
      ledger.records.unshift(next);
    }
    ledger.updatedAt = new Date().toISOString();
    await saveDataAndRender();
    closeModal();
  }
}

function showConsumerModal(consumer = null) {
  const editing = Boolean(consumer);
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
    draft.name = { "zh-CN": zhInput.value.trim(), "en-US": enInput.value.trim() || zhInput.value.trim() };
    draft.active = activeInput.checked;
    if (!draft.name["zh-CN"]) return;

    if (editing) Object.assign(consumer, draft);
    else state.config.consumers.push(draft);
    await saveConfigAndRender();
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

function openModal(title, body) {
  clear(modalRoot);
  modalRoot.append(el("div", { className: "modal-backdrop", on: { click: (event) => { if (event.target.classList.contains("modal-backdrop")) closeModal(); } } }, [
    el("section", { className: "modal glass" }, [
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

async function toggleArchive(ledgerId) {
  const ledger = getLedger(ledgerId);
  if (!ledger) return;
  ledger.archived = !ledger.archived;
  ledger.updatedAt = new Date().toISOString();
  await saveDataAndRender();
}

async function deleteRecord(ledgerId, recordId) {
  if (!confirm(t("confirmDeleteRecord"))) return;
  const ledger = getLedger(ledgerId);
  const record = ledger?.records?.find((item) => item.id === recordId);
  if (!record) return;
  record.deleted = true;
  record.updatedAt = new Date().toISOString();
  await saveDataAndRender();
}

async function deleteConsumer(consumerId) {
  if (!confirm(t("confirmDeleteConsumer"))) return;
  state.config.consumers = state.config.consumers.filter((consumer) => consumer.id !== consumerId);
  for (const ledger of state.data.ledgers) {
    ledger.participantIds = (ledger.participantIds || []).filter((id) => id !== consumerId);
  }
  await saveConfigAndRender();
  await saveDataAndRender(false);
}

async function refreshData() {
  const previousView = state.view;
  const previousLedgerId = state.selectedLedgerId;
  try {
    toast(t("refreshingData"));
    const payload = await api.bootstrap();
    setBootstrap(payload);
    state.view = previousView;
    state.selectedLedgerId = previousLedgerId;
    if (state.view === "ledger" && (!previousLedgerId || !getLedger(previousLedgerId))) {
      state.view = "dashboard";
      state.selectedLedgerId = null;
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
    updateCache();
    renderApp();
    toast(t("updated"), "success");
  } catch (error) {
    toast(`${t("loadFailed")}: ${error.message}`, "error");
  }
}

async function saveDataAndRender(shouldRender = true) {
  try {
    state.saving = true;
    toast(t("saving"));
    const payload = await api.saveData(state.data, state.dataSha);
    state.dataSha = payload.sha;
    state.lastSync = payload.updatedAt || new Date().toISOString();
    updateCache();
    if (shouldRender) renderApp();
    toast(t("saved"), "success");
  } catch (error) {
    const message = error.code === "GITHUB_CONFLICT" ? t("conflict") : `${t("saveFailed")}: ${error.message}`;
    toast(message, "error");
  } finally {
    state.saving = false;
  }
}

async function saveConfigAndRender() {
  try {
    state.saving = true;
    toast(t("saving"));
    const payload = await api.saveConfig(state.config, state.configSha);
    state.configSha = payload.sha;
    state.lastSync = payload.updatedAt || new Date().toISOString();
    updateCache();
    renderApp();
    toast(t("saved"), "success");
  } catch (error) {
    const message = error.code === "GITHUB_CONFLICT" ? t("conflict") : `${t("saveFailed")}: ${error.message}`;
    toast(message, "error");
  } finally {
    state.saving = false;
  }
}

function toast(message, type = "info") {
  const item = el("div", { className: `toast ${type}`, text: message });
  toastBox.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function consumerName(id) {
  const consumer = state.config.consumers.find((item) => item.id === id);
  return localizedName(consumer?.name, id);
}

function bindNetworkEvents() {
  window.addEventListener("offline", () => toast(t("offline"), "error"));
  window.addEventListener("online", () => toast(t("online"), "success"));
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
    navigator.serviceWorker.register(swUrl, { scope: swScope }).catch(() => undefined);
  });
}
