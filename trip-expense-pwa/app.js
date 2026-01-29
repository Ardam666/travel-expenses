window.addEventListener("DOMContentLoaded", () => {

// ---------- Helpers ----------
function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const $ = (id) => document.getElementById(id);

const money = (n) =>
  (Number(n || 0)).toLocaleString("es-AR", { style: "currency", currency: "USD" });

const todayISO = () => new Date().toISOString();

const DEFAULT_CATEGORIES = [
  "Café",
  "Supermercado",
  "Restaurante",
  "Transporte",
  "Taxi / Uber",
  "Alojamiento",
  "Compras",
  "Entradas",
  "Salud",
  "Propinas",
  "Otros",
];

// ---------- IndexedDB ----------
const DB_NAME = "trip-expense-pwa";
const DB_VER = 1;

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const d = req.result;

      // expenses
      if (!d.objectStoreNames.contains("expenses")) {
        const s = d.createObjectStore("expenses", { keyPath: "id" });
        s.createIndex("date", "date");
      }

      // categories
      if (!d.objectStoreNames.contains("categories")) {
        d.createObjectStore("categories", { keyPath: "name" });
      }

      // settings
      if (!d.objectStoreNames.contains("settings")) {
        d.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

// ---------- Settings ----------
function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    const s = store("settings", "readwrite");
    const req = s.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function getSetting(key) {
  return new Promise((resolve, reject) => {
    const s = store("settings");
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ---------- FX (dólar oficial automático) ----------
async function getFxRateAuto() {
  const res = await fetch("/.netlify/functions/fx", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo obtener el dólar oficial");
  const data = await res.json();
  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Tipo de cambio inválido");
  return rate; // ARS por 1 USD
}

// ---------- Categories ----------
async function seedDefaultCategoriesIfEmpty() {
  const cats = await getAllCategories();
  if (cats.length) return;

  for (const name of DEFAULT_CATEGORIES) {
    await addCategory(name);
  }
}

function addCategory(name) {
  name = String(name || "").trim();
  if (!name) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const s = store("categories", "readwrite");
    const req = s.put({ name });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteCategory(name) {
  return new Promise((resolve, reject) => {
    const s = store("categories", "readwrite");
    const req = s.delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllCategories() {
  return new Promise((resolve, reject) => {
    const s = store("categories");
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Expenses ----------
function addExpense(expense) {
  return new Promise((resolve, reject) => {
    const s = store("expenses", "readwrite");
    const req = s.put(expense);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteExpense(id) {
  return new Promise((resolve, reject) => {
    const s = store("expenses", "readwrite");
    const req = s.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllExpenses() {
  return new Promise((resolve, reject) => {
    const s = store("expenses");
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ---------- UI ----------
function showScreen(name) {
  for (const el of document.querySelectorAll(".screen")) {
    el.classList.toggle("hidden", el.id !== name);
  }
  for (const btn of document.querySelectorAll("[data-screen]")) {
    btn.classList.toggle("active", btn.dataset.screen === name);
  }
}

async function renderCategoriesDropdown() {
  const cats = await getAllCategories();
  const sel = $("categorySelect");
  sel.innerHTML = "";
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
}

async function renderCategoriesManager() {
  const cats = await getAllCategories();
  const list = $("categoriesList");
  list.innerHTML = "";

  for (const c of cats) {
    const row = document.createElement("div");
    row.className = "row";

    const name = document.createElement("div");
    name.textContent = c.name;
    name.className = "grow";

    const del = document.createElement("button");
    del.textContent = "Eliminar";
    del.className = "btn danger";
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar categoría "${c.name}"?`)) return;
      await deleteCategory(c.name);
      await renderCategoriesDropdown();
      await renderCategoriesManager();
    });

    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
  }
}

function fmtDateShort(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-AR");
  } catch {
    return iso;
  }
}

async function renderRecent() {
  const expenses = await getAllExpenses();
  expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

  const list = $("recentList");
  list.innerHTML = "";

  const recent = expenses.slice(0, 12);

  for (const e of recent) {
    const row = document.createElement("div");
    row.className = "card";

    const top = document.createElement("div");
    top.className = "row";

    const title = document.createElement("div");
    title.className = "grow";
    const cat = e.category || "—";
    const storeTxt = e.store ? ` · ${e.store}` : "";
    title.textContent = `${cat}${storeTxt}`;

    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "icon danger";
    del.title = "Eliminar";
    del.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este gasto?")) return;
      await deleteExpense(e.id);
      await renderAll();
    });

    top.appendChild(title);
    top.appendChild(del);

    const sub = document.createElement("div");
    sub.className = "muted";
    const aUSD = money(e.amountUSD);
    const aARS = e.amountARS != null
      ? (Number(e.amountARS)).toLocaleString("es-AR", { style: "currency", currency: "ARS" })
      : "—";

    sub.textContent = `${fmtDateShort(e.date)} · USD ${aUSD} · ARS ${aARS}`;

    row.appendChild(top);
    row.appendChild(sub);
    list.appendChild(row);
  }
}

async function renderSummary() {
  const expenses = await getAllExpenses();
  expenses.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Totales
  const total = expenses.reduce((s, e) => s + Number(e.amountUSD ?? 0), 0);
  $("totalSpent").textContent = money(total);

  // Presupuesto
  const tripBudget = await getSetting("tripBudget");
  const dailyBudget = await getSetting("dailyBudget");

  let label = "Sin presupuesto";
  let pct = 0;

  if (tripBudget && tripBudget > 0) {
    pct = Math.min(100, (total / tripBudget) * 100);
    label = `${money(total)} / ${money(tripBudget)}`;
  } else if (dailyBudget && dailyBudget > 0) {
    const hoy = new Date().toLocaleDateString("es-AR");
    const totalHoy = expenses
      .filter(e => new Date(e.date).toLocaleDateString("es-AR") === hoy)
      .reduce((s, e) => s + Number(e.amountUSD ?? 0), 0);
    pct = Math.min(100, (totalHoy / dailyBudget) * 100);
    label = `Hoy: ${money(totalHoy)} / ${money(dailyBudget)}`;
  }

  $("budgetLabel").textContent = label;
  $("progressFill").style.width = `${pct}%`;

  // Por categoría
  const byCat = new Map();
  for (const e of expenses) {
    const k = (e.category || "Otros").trim();
    byCat.set(k, (byCat.get(k) || 0) + Number(e.amountUSD ?? 0));
  }

  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catList = $("byCategoryList");
  catList.innerHTML = "";
  for (const [k, v] of cats) {
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.className = "grow";
    left.textContent = k;
    const right = document.createElement("div");
    right.textContent = money(v);
    row.appendChild(left);
    row.appendChild(right);
    catList.appendChild(row);
  }

  // Por día
  const byDay = new Map();
  for (const e of expenses) {
    const day = new Date(e.date).toLocaleDateString("es-AR");
    byDay.set(day, (byDay.get(day) || 0) + Number(e.amountUSD ?? 0));
  }
  const days = [...byDay.entries()].sort((a, b) => {
    const da = new Date(a[0].split("/").reverse().join("-"));
    const dbb = new Date(b[0].split("/").reverse().join("-"));
    return da - dbb;
  });

  const dayList = $("byDayList");
  dayList.innerHTML = "";
  for (const [k, v] of days) {
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.className = "grow";
    left.textContent = k;
    const right = document.createElement("div");
    right.textContent = money(v);
    row.appendChild(left);
    row.appendChild(right);
    dayList.appendChild(row);
  }
}

async function renderBudgetScreen() {
  const fx = await getSetting("fxRate");
  const tripBudget = await getSetting("tripBudget");
  const dailyBudget = await getSetting("dailyBudget");

  $("fxRateInput").value = fx ?? "";
  $("tripBudgetInput").value = tripBudget ?? "";
  $("dailyBudgetInput").value = dailyBudget ?? "";

  const updated = await getSetting("fxLastUpdated");
  $("fxLastUpdated").textContent = updated
    ? new Date(updated).toLocaleString("es-AR")
    : "—";
}

async function exportCSV() {
  const expenses = await getAllExpenses();
  expenses.sort((a, b) => new Date(a.date) - new Date(b.date));

  const header = ["date", "category", "store", "currency", "amountOriginal", "amountARS", "amountUSD", "fxRateUsed"];
  const lines = [header.join(",")];

  for (const e of expenses) {
    const row = [
      e.date,
      (e.category || "").replaceAll(",", " "),
      (e.store || "").replaceAll(",", " "),
      e.currency || "",
      e.amountOriginal ?? "",
      e.amountARS ?? "",
      e.amountUSD ?? "",
      e.fxRateUsed ?? "",
    ];
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "gastos.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function renderAll() {
  await renderCategoriesDropdown();
  await renderRecent();
  await renderSummary();
  await renderCategoriesManager();
  await renderBudgetScreen();
}

// ---------- Event handlers ----------
$("navHome")?.addEventListener("click", () => showScreen("screenHome"));
$("navSummary")?.addEventListener("click", () => showScreen("screenSummary"));

$("navBudget")?.addEventListener("click", async () => {
  await renderBudgetScreen();
  showScreen("screenBudget");
});

$("navCategories")?.addEventListener("click", async () => {
  await renderCategoriesManager();
  showScreen("screenCategories");
});

$("addCategoryBtn")?.addEventListener("click", async () => {
  const name = $("newCategoryInput").value.trim();
  if (!name) return;
  await addCategory(name);
  $("newCategoryInput").value = "";
  await renderCategoriesDropdown();
  await renderCategoriesManager();
});

$("saveBudgetBtn")?.addEventListener("click", async () => {
  const fx = toNumberOrNull($("fxRateInput").value);
  const trip = toNumberOrNull($("tripBudgetInput").value);
  const daily = toNumberOrNull($("dailyBudgetInput").value);

  if (fx != null) await setSetting("fxRate", fx);
  if (trip != null) await setSetting("tripBudget", trip);
  if (daily != null) await setSetting("dailyBudget", daily);

  await setSetting("fxLastUpdated", Date.now());
  await renderAll();
  alert("Guardado.");
});

$("exportBtn")?.addEventListener("click", exportCSV);

$("expenseForm")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const category = $("categorySelect").value;
  const storeName = $("storeInput")?.value?.trim();
  const store = storeName ? storeName : null;

  if ($("storeInput")) {
    $("storeInput").value = "";
  }

  const currency = $("currencySelect").value; // ARS or USD
  const amount = toNumberOrNull($("amountInput").value);
  if (!(amount >= 0)) return;

  let fx = await getSetting("fxRate"); // ARS por 1 USD
  // Si el gasto es en ARS, intentamos traer el dólar oficial automáticamente.
  if (currency === "ARS") {
    try {
      fx = await getFxRateAuto();
      await setSetting("fxRate", fx);
      await setSetting("fxLastUpdated", Date.now());
    } catch (e) {
      // Si falla internet, usamos el último guardado (si existe).
      if (!fx || fx <= 0) {
        return alert("No se pudo obtener el dólar oficial y no hay tipo de cambio guardado. Probá de nuevo con internet.");
      }
    }
  }

  let amountARS = null;
  let amountUSD = null;

  if (currency === "ARS") {
    amountARS = amount;
    amountUSD = amount / fx;
  } else {
    amountUSD = amount;
    amountARS = fx && fx > 0 ? amount * fx : null;
  }

  const expense = {
    id: crypto.randomUUID(),
    category,
    store,
    currency,
    amountOriginal: amount,
    amountARS,
    amountUSD,
    fxRateUsed: fx || null,
    date: todayISO()
  };

  await addExpense(expense);

  $("amountInput").value = "";
  await renderAll();
});


// ---------- Init ----------
(async function init() {
  db = await openDB();
  await seedDefaultCategoriesIfEmpty();
  await renderAll();
  showScreen("screenHome");
})();

});

