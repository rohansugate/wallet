/**
 * Vault — Personal Finance Tracker
 * Persists all data to localStorage under STORAGE_KEY.
 */

const STORAGE_KEY = "vaultFinanceData";

const defaultState = () => ({
  transactions: [],
  owedToMe: [],
  iOwe: [],
  wallet: {
    adjustments: [],
  },
});

// ─── Storage ───

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      wallet: { ...defaultState().wallet, ...parsed.wallet },
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

// ─── Wallet (always synced to Cash In/Out) ───

function cashFlowNet() {
  return state.transactions.reduce(
    (sum, t) => sum + (t.type === "in" ? t.amount : -t.amount),
    0
  );
}

function adjustmentsNet() {
  return (state.wallet.adjustments || []).reduce((sum, a) => sum + a.delta, 0);
}

function walletBalance() {
  return Math.round((cashFlowNet() + adjustmentsNet()) * 100) / 100;
}

function migrateWallet() {
  if (state.wallet._syncedV2) return;

  const legacyBalance = state.wallet.balance;
  const legacyHistory = state.wallet.history || [];

  if (!state.wallet.adjustments) {
    state.wallet.adjustments = legacyHistory
      .filter((h) => h.type !== "Cash in" && h.type !== "Cash out")
      .map((h) => ({
        id: h.id || uid(),
        delta: h.delta,
        note: h.note || h.type,
        date: h.date || todayISO(),
        createdAt: h.createdAt || Date.now(),
      }));
  }

  const cash = cashFlowNet();
  const adj = adjustmentsNet();
  const computed = cash + adj;

  if (Number.isFinite(legacyBalance) && Math.abs(legacyBalance - computed) > 0.001) {
    state.wallet.adjustments.push({
      id: uid(),
      delta: Math.round((legacyBalance - computed) * 100) / 100,
      note: "Balance sync",
      date: todayISO(),
      createdAt: Date.now(),
    });
  }

  delete state.wallet.balance;
  delete state.wallet.history;
  state.wallet._syncedV2 = true;
  saveState(state);
}

// ─── Utilities ───

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatMoney(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseAmount(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

let toastTimer;
function showToast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ─── Calculations ───

function sumTransactions(type) {
  return state.transactions
    .filter((t) => t.type === type)
    .reduce((s, t) => s + t.amount, 0);
}

function sumDebts(list) {
  return list.reduce((s, d) => s + d.amount, 0);
}

function netPosition() {
  const wallet = walletBalance();
  const owed = sumDebts(state.owedToMe);
  const owe = sumDebts(state.iOwe);
  return wallet + owed - owe;
}

// ─── Render ───

function renderSummary() {
  const wallet = walletBalance();
  const owed = sumDebts(state.owedToMe);
  const owe = sumDebts(state.iOwe);
  const net = netPosition();
  const cashNet = cashFlowNet();
  const adjNet = adjustmentsNet();

  document.getElementById("summaryWallet").textContent = formatMoney(wallet);
  document.getElementById("summaryOwedToMe").textContent = formatMoney(owed);
  document.getElementById("summaryIOwe").textContent = formatMoney(owe);
  document.getElementById("summaryNet").textContent = formatMoney(net);

  document.getElementById("cashInTotal").textContent = formatMoney(sumTransactions("in"));
  document.getElementById("cashOutTotal").textContent = formatMoney(sumTransactions("out"));

  const walletEl = document.getElementById("walletDisplay");
  walletEl.textContent = formatMoney(wallet);
  walletEl.classList.toggle("negative", wallet < 0);

  const ring = document.getElementById("walletRing");
  const circumference = 2 * Math.PI * 52;
  const progress = Math.min(Math.abs(wallet) / Math.max(Math.abs(net), 1, 1000), 1);
  ring.style.strokeDashoffset = circumference * (1 - progress);
  ring.style.stroke = wallet < 0 ? "var(--danger)" : "var(--accent)";

  const hint = document.getElementById("walletHint");
  if (adjNet === 0) {
    hint.textContent = "Synced with Cash In/Out — add entries above to update";
  } else {
    hint.textContent = `${formatMoney(cashNet)} from cash log ${adjNet >= 0 ? "+" : "−"} ${formatMoney(Math.abs(adjNet))} manual`;
  }

  const breakdown = document.getElementById("walletBreakdown");
  if (!breakdown) return;
  breakdown.innerHTML = `
    <div class="wallet-breakdown__item">
      <span class="wallet-breakdown__label">Cash In/Out net</span>
      <span class="wallet-breakdown__value ${cashNet >= 0 ? "wallet-breakdown__value--in" : "wallet-breakdown__value--out"}">${formatMoney(cashNet)}</span>
    </div>
    <div class="wallet-breakdown__item">
      <span class="wallet-breakdown__label">Manual corrections</span>
      <span class="wallet-breakdown__value wallet-breakdown__value--adj">${formatMoney(adjNet)}</span>
    </div>
    <div class="wallet-breakdown__item">
      <span class="wallet-breakdown__label">Cash on hand</span>
      <span class="wallet-breakdown__value">${formatMoney(wallet)}</span>
    </div>
  `;
}

function createDeleteBtn(onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.setAttribute("aria-label", "Delete");
  btn.textContent = "×";
  btn.addEventListener("click", onClick);
  return btn;
}

function renderCashList() {
  const list = document.getElementById("cashList");
  const search = document.getElementById("cashSearch").value.toLowerCase().trim();
  const filter = document.getElementById("cashFilter").value;

  const items = [...state.transactions]
    .filter((t) => filter === "all" || t.type === filter)
    .filter((t) => {
      if (!search) return true;
      const hay = `${t.description} ${t.date} ${t.amount}`.toLowerCase();
      return hay.includes(search);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  list.innerHTML = "";

  items.forEach((t) => {
    const li = document.createElement("li");
    li.className = "log-item";
    li.innerHTML = `
      <span class="log-item__badge log-item__badge--${t.type}">${t.type === "in" ? "In" : "Out"}</span>
      <div class="log-item__body">
        <div class="log-item__title">${escapeHtml(t.description || "No description")}</div>
        <div class="log-item__meta">${formatDisplayDate(t.date)}</div>
      </div>
      <span class="log-item__amount log-item__amount--${t.type}">${t.type === "in" ? "+" : "−"}${formatMoney(t.amount).replace("-", "")}</span>
    `;
    li.appendChild(
      createDeleteBtn(() => {
        removeTransaction(t.id);
      })
    );
    list.appendChild(li);
  });

  document.getElementById("cashEmpty").classList.toggle("hidden", items.length > 0);
}

function renderDebtList(listId, emptyId, items, amountClass) {
  const ul = document.getElementById(listId);
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);

  ul.innerHTML = "";
  sorted.forEach((d) => {
    const li = document.createElement("li");
    li.className = "debt-item log-item";
    li.innerHTML = `
      <div class="log-item__body">
        <div class="debt-item__person">${escapeHtml(d.person)}</div>
        ${d.note ? `<div class="debt-item__note">${escapeHtml(d.note)}</div>` : ""}
      </div>
      <span class="log-item__amount ${amountClass}">${formatMoney(d.amount)}</span>
    `;
    li.appendChild(
      createDeleteBtn(() => {
        removeDebt(listId === "owedToMeList" ? "owedToMe" : "iOwe", d.id);
      })
    );
    ul.appendChild(li);
  });

  document.getElementById(emptyId).classList.toggle("hidden", sorted.length > 0);
}

function renderWalletHistory() {
  const ul = document.getElementById("walletHistory");
  const adjustments = [...(state.wallet.adjustments || [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);

  ul.innerHTML = "";
  adjustments.forEach((h) => {
    const li = document.createElement("li");
    li.className = "log-item";
    const sign = h.delta >= 0 ? "+" : "−";
    li.innerHTML = `
      <div class="log-item__body">
        <div class="log-item__title">${escapeHtml(h.note)}</div>
        <div class="log-item__meta">${formatDisplayDate(h.date)} · Manual correction</div>
      </div>
      <span class="log-item__amount ${h.delta >= 0 ? "log-item__amount--in" : "log-item__amount--out"}">${sign}${formatMoney(Math.abs(h.delta)).replace("-", "")}</span>
    `;
    li.appendChild(
      createDeleteBtn(() => {
        state.wallet.adjustments = state.wallet.adjustments.filter((x) => x.id !== h.id);
        persist();
        showToast("Correction removed");
      })
    );
    ul.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  renderSummary();
  renderCashList();
  renderDebtList("owedToMeList", "owedToMeEmpty", state.owedToMe, "debt-item__amount--in");
  renderDebtList("iOweList", "iOweEmpty", state.iOwe, "debt-item__amount--out");
  renderWalletHistory();
}

// ─── Mutations ───

function persist() {
  saveState(state);
  renderAll();
}

function addTransaction({ type, amount, description, date }) {
  state.transactions.push({
    id: uid(),
    type,
    amount,
    description: description.trim(),
    date,
    createdAt: Date.now(),
  });
  persist();
  showToast(`${type === "in" ? "Cash in" : "Cash out"} recorded · Wallet updated`);
}

function removeTransaction(id) {
  state.transactions = state.transactions.filter((x) => x.id !== id);
  persist();
  showToast("Transaction removed · Wallet updated");
}

function addDebt(kind, { person, amount, note }) {
  const entry = {
    id: uid(),
    person: person.trim(),
    amount,
    note: (note || "").trim(),
    createdAt: Date.now(),
  };
  state[kind].push(entry);
  persist();
  showToast(kind === "owedToMe" ? "Receivable added" : "Payable added");
}

function removeDebt(kind, id) {
  state[kind] = state[kind].filter((d) => d.id !== id);
  persist();
  showToast("Debt entry removed");
}

function addAdjustment(delta, note, date) {
  if (!state.wallet.adjustments) state.wallet.adjustments = [];
  state.wallet.adjustments.unshift({
    id: uid(),
    delta: Math.round(delta * 100) / 100,
    note,
    date: date || todayISO(),
    createdAt: Date.now(),
  });
  if (state.wallet.adjustments.length > 50) {
    state.wallet.adjustments = state.wallet.adjustments.slice(0, 50);
  }
}

function setWalletBalance(amount, note) {
  const delta = amount - walletBalance();
  if (Math.abs(delta) < 0.001) return;
  addAdjustment(delta, note || "Set balance to match bank");
}

// ─── Event handlers ───

function initDateFields() {
  const dateInput = document.getElementById("cashDate");
  dateInput.value = todayISO();
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

document.getElementById("cashForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const type = document.getElementById("cashType").value;
  const amount = parseAmount(document.getElementById("cashAmount").value);
  const description = document.getElementById("cashDescription").value;
  const date = document.getElementById("cashDate").value;

  if (!amount || amount <= 0) {
    showToast("Enter a valid amount");
    return;
  }

  addTransaction({ type, amount, description, date });
  e.target.reset();
  document.getElementById("cashType").value = type;
  document.getElementById("cashDate").value = todayISO();
});

document.getElementById("cashSearch").addEventListener("input", renderCashList);
document.getElementById("cashFilter").addEventListener("change", renderCashList);

document.getElementById("owedToMeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const amount = parseAmount(fd.get("amount"));
  if (!amount || amount <= 0) {
    showToast("Enter a valid amount");
    return;
  }
  addDebt("owedToMe", {
    person: fd.get("person"),
    amount,
    note: fd.get("note"),
  });
  e.target.reset();
});

document.getElementById("iOweForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const amount = parseAmount(fd.get("amount"));
  if (!amount || amount <= 0) {
    showToast("Enter a valid amount");
    return;
  }
  addDebt("iOwe", {
    person: fd.get("person"),
    amount,
    note: fd.get("note"),
  });
  e.target.reset();
});

document.getElementById("walletForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const submitter = e.submitter;
  const action = submitter?.value || "adjust";

  if (action === "set") {
    const amount = parseAmount(document.getElementById("setBalance").value);
    if (!Number.isFinite(amount)) {
      showToast("Enter a balance to set");
      return;
    }
    setWalletBalance(amount, "Set balance to match bank");
    persist();
    showToast("Correction added · total now matches your entry");
    document.getElementById("setBalance").value = "";
    return;
  }

  const delta = parseAmount(document.getElementById("adjustAmount").value);
  if (!Number.isFinite(delta) || delta === 0) {
    showToast("Enter a non-zero adjustment");
    return;
  }
  const note = document.getElementById("adjustNote").value.trim() || "Manual adjustment";
  addAdjustment(delta, note, todayISO());
  persist();
  showToast("Correction applied on top of cash log");
  document.getElementById("adjustAmount").value = "";
  document.getElementById("adjustNote").value = "";
});

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vault-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Backup downloaded");
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("Delete all saved data? This cannot be undone.")) return;
  state = defaultState();
  persist();
  showToast("All data reset");
});

// ─── Boot ───

try {
  if (!state.wallet || typeof state.wallet !== "object") {
    state.wallet = defaultState().wallet;
  }
  migrateWallet();
  initDateFields();
  renderAll();
} catch (err) {
  console.error("Vault failed to start:", err);
  const msg = document.createElement("p");
  msg.style.cssText = "color:#ff6b7a;padding:2rem;font-family:system-ui,sans-serif;max-width:32rem";
  msg.textContent =
    "App failed to load. Hard-refresh (Cmd+Shift+R). If it persists, clear site data for localhost in browser settings.";
  document.body.appendChild(msg);
}
