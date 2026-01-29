// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

const money = (n) =>
  (Number(n || 0)).toLocaleString("es-AR", { style: "currency", currency: "USD" });

const moneyARS = (n) =>
  (Number(n || 0)).toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const todayISO = () => new Date().toISOString();

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_CATEGORIES = [
  "Café",
  "Supermercado",
  "Restaurante",
  "Transporte",
  "Taxi / Uber",
  "Propina",
  "Farmacia",
  "Compras",
  "Entretenimiento",
  "Otros",
];

// ---------- IndexedDB ----------
const DB_NAME = "expenseDB";
const DB_VERSION = 2;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("expenses")) {
        d.createObjectStore("expenses", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("settings")) {
        d.createObjectStore("settings", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("categories")) {
        d.createObjectStore("categories", { keyPath: "name" });
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

// Settings
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

// Categories
function addCategory(name) {
  const clean = (name || "").trim();
  if (!clean) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const s = store("categories", "readwrite");
    const req = s.put({ name: clean });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllCategories() {
  return new Promise((resolve, reject) => {
    const s = store("categories");
    const req = s.getAll();
    req.onsuccess = () =>
      resolve((req.result || []).map((x) => x.name).sort((a, b) => a.localeCompare(b, "es")));
    req.onerror = () => reject(req.error);
  });
}

async function seedDefaultCategoriesIfEmpty() {
  const cats = await getAllCategories();
  if (cats.length) return;
  await Promise.all(DEFAULT_CATEGORIES.map(addCategory));
}

async function resetCategoriesToDefault() {
  await new Promise((res, rej) => {
    const tx = db.transaction(["categories"], "readwrite");
    tx.objectStore("categories").clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  await Promise.all(DEFAULT_CATEGORIES.map(addCategory));
  await refreshCategoryDropdown();
}

// Expenses
function addExpense(expense) {
  return new Promise((resolve, reject) => {
    const s = store("expenses", "readwrite");
    const req = s.add(expense);
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

function deleteExpense(id) {
  return new Promise((resolve, reject) => {
    const s = store("expenses", "readwrite");
    const req = s.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearAllData() {
  await new Promise((res, rej) => {
    const tx = db.transaction(["expenses", "settings", "categories"], "readwrite");
    tx.objectStore("expenses").clear();
    tx.objectStore("settings").clear();
    tx.objectStore("categories").clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- UI: Tabs ----------
function showView(name) {
  const views = {
    expenses: $("viewExpenses"),
    summary: $("viewSummary"),
    settings: $("viewSettings"),
  };
  const tabs = {
    expenses: $("tabExpenses"),
    summary: $("tabSummary"),
    settings: $("tabSettings"),
  };

  Object.values(views).forEach((v) => v.classList.add("hidden"));
  Object.values(tabs).forEach((t) => t.classList.remove("active"));
  views[name].classList.remove("hidden");
  tabs[name].classList.add("active");

  if (name === "summary") renderSummary();
  if (name === "expenses") renderList();
  if (name === "settings") loadBudgetInputs();
}

// ---------- UI: Category dropdown ----------
async function refreshCategoryDropdown(selected = null) {
  const sel = $("categorySelect");
  const newWrap = $("newCategoryWrap");
  const newInput = $("newCategoryInput");

  const cats = await getAllCategories();

  // If HTML already has fallback options, wipe and rebuild
  sel.innerHTML = "";

  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }

  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "➕ Agregar nueva categoría…";
  sel.appendChild(optNew);

  if (selected && cats.includes(selected)) sel.value = selected;

  sel.onchange = () => {
    if (sel.value === "__new__") {
      newWrap.style.display = "block";
      newInput.focus();
    } else {
      newWrap.style.display = "none";
      newInput.value = "";
    }
  };
}

// ---------- UI: Conversion hint ----------
async function updateConversionHint() {
  const hint = $("conversionHint");
  const currency = $("currencySelect")?.value || "ARS";
  const amount = toNumberOrNull($("amountInput")?.value);
  const fx = await getSetting("fxRate"); // ARS per 1 USD

  if (!fx || fx <= 0) {
    hint.textContent = "Tipo de cambio no configurado.";
    return;
  }

  if (!amount || amount <= 0) {
    hint.textContent = `1 USD = ${Number(fx).toLocaleString("es-AR")} ARS`;
    return;
  }

  if (currency === "ARS") {
    const usd = amount / fx;
    hint.textContent = `Equivale a: ${usd.toLocaleString("es-AR", { style: "currency", currency: "USD" })} (a ${fx} ARS/USD)`;
  } else {
    const ars = amount * fx;
    hint.textContent = `Equivale a: ${ars.toLocaleString("es-AR", { style: "currency", currency: "ARS" })} (a ${fx} ARS/USD)`;
  }
}

// ---------- Render: List ----------
async function renderList() {
  const list = $("expenseList");
  const expenses = (await getAllExpenses()).sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = "";

  if (!expenses.length) {
    list.innerHTML = `<li><span class="muted">Todavía no hay gastos.</span><span></span></li>`;
    return;
  }

  for (const ex of expenses.slice(0, 30)) {
    const date = new Date(ex.date);

    const original =
      ex.currency === "ARS"
        ? moneyARS(ex.amountARS ?? ex.amountOriginal)
        : (Number(ex.amountOriginal ?? 0)).toLocaleString("es-AR", { style: "currency", currency: "USD" });

    const left = document.createElement("span");
    left.textContent = `${ex.category} · ${date.toLocaleDateString("es-AR")} · ${original}`;

    const right = document.createElement("span");
    right.textContent = money(ex.amountUSD ?? ex.amountOriginal ?? 0);

    const li = document.createElement("li");
    li.append(left, right);

    li.ondblclick = async () => {
      if (confirm("¿Borrar este gasto?")) {
        await deleteExpense(ex.id);
        renderList();
      }
    };

    list.appendChild(li);
  }
}

// ---------- Render: Summary ----------
async function renderSummary() {
  const expenses = await getAllExpenses();

  const total = expenses.reduce((sum, e) => sum + Number(e.amountUSD ?? e.amountOriginal ?? 0), 0);

  $("totalSpent").textContent = money(total);

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
      .filter((e) => new Date(e.date).toLocaleDateString("es-AR") === hoy)
      .reduce((s, e) => s + Number(e.amountUSD ?? e.amountOriginal ?? 0), 0);

    pct = Math.min(100, (totalHoy / dailyBudget) * 100);
    label = `Hoy: ${money(totalHoy)} / ${money(dailyBudget)}`;
  }

  $("budgetLabel").textContent = label;
  $("progressFill").style.width = `${pct}%`;

  // Por categoría (USD)
  const byCat = new Map();
  for (const e of expenses) {
    const k = (e.category || "Otros").trim();
    byCat.set(k, (byCat.get(k) || 0) + Number(e.amountUSD ?? e.amountOriginal ?? 0));
  }

  const catList = $("byCategory");
  catList.innerHTML = "";
  if (!byCat.size) {
    catList.innerHTML = `<li><span class="muted">No hay datos todavía.</span><span></span></li>`;
  } else {
    [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([k, v]) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${k}</span><span>${money(v)}</span>`;
        catList.appendChild(li);
      });
  }

  // Por día (USD)
  const byDay = new Map();
  for (const e of expenses) {
    const d = new Date(e.date).toLocaleDateString("es-AR");
    byDay.set(d, (byDay.get(d) || 0) + Number(e.amountUSD ?? e.amountOriginal ?? 0));
  }

  const dayList = $("byDay");
  dayList.innerHTML = "";
  if (!byDay.size) {
    dayList.innerHTML = `<li><span class="muted">No hay datos todavía.</span><span></span></li>`;
  } else {
    [...byDay.entries()]
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .slice(0, 30)
      .forEach(([d, v]) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${d}</span><span>${money(v)}</span>`;
        dayList.appendChild(li);
      });
  }
}

// ---------- Budget + categories settings ----------
async function loadBudgetInputs() {
  const trip = await getSetting("tripBudget");
  const daily = await getSetting("dailyBudget");
  const fx = await getSetting("fxRate");

  $("tripBudget").value = trip ?? "";
  $("dailyBudget").value = daily ?? "";
  $("fxRate").value = fx ?? "";
}

// ---------- Export CSV ----------
async function exportCSV() {
  const expenses = (await getAllExpenses()).sort((a, b) => new Date(a.date) - new Date(b.date));

  const rows = [
    ["fecha_iso", "categoria", "moneda", "monto_original", "monto_ars", "monto_usd", "tipo_cambio_usado"],
    ...expenses.map((e) => [
      new Date(e.date).toISOString(),
      e.category ?? "",
      e.currency ?? "",
      String(e.amountOriginal ?? ""),
      String(e.amountARS ?? ""),
      String(e.amountUSD ?? ""),
      String(e.fxRateUsed ?? ""),
    ]),
  ];

  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "gastos-viaje.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Init ----------
window.addEventListener("DOMContentLoaded", async () => {
  await openDB();
  await seedDefaultCategoriesIfEmpty();
  await refreshCategoryDropdown();
  await loadBudgetInputs();

  $("tabExpenses").onclick = () => showView("expenses");
  $("tabSummary").onclick = () => showView("summary");
  $("tabSettings").onclick = () => showView("settings");

  $("currencySelect")?.addEventListener("change", updateConversionHint);
  $("amountInput")?.addEventListener("input", updateConversionHint);

  $("saveBudget").onclick = async () => {
    const trip = toNumberOrNull($("tripBudget").value);
    const daily = toNumberOrNull($("dailyBudget").value);
    const fxRate = toNumberOrNull($("fxRate").value);

    await setSetting("tripBudget", trip);
    await setSetting("dailyBudget", daily);
    await setSetting("fxRate", fxRate);

    await updateConversionHint();
    showView("summary");
  };

  $("addCategoryBtn").onclick = async () => {
    const input = $("addCategoryInput");
    const name = input.value.trim();
    if (!name) return;
    await addCategory(name);
    input.value = "";
    await refreshCategoryDropdown(name);
    alert("Categoría agregada.");
  };

  $("resetCategories").onclick = async () => {
    if (!confirm("¿Restablecer categorías a las predeterminadas?")) return;
    await resetCategoriesToDefault();
    alert("Listo.");
  };

  $("clearAll").onclick = async () => {
    if (!confirm("¿Borrar todos los gastos, presupuestos y categorías?")) return;
    await clearAllData();
    await seedDefaultCategoriesIfEmpty();
    await refreshCategoryDropdown();
    await loadBudgetInputs();
    await renderList();
    await renderSummary();
    showView("expenses");
  };

  $("exportBtn").onclick = exportCSV;

  $("expenseForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    let category = $("categorySelect").value;

    if (category === "__new__") {
      const typed = $("newCategoryInput").value.trim();
      if (!typed) return alert("Escribí el nombre de la nueva categoría.");
      await addCategory(typed);
      category = typed;
      await refreshCategoryDropdown(category);
      $("newCategoryWrap").style.display = "none";
      $("newCategoryInput").value = "";
    }

    const currency = $("currencySelect").value; // ARS / USD
    const amount = toNumberOrNull($("amountInput").value);
    if (!(amount >= 0)) return;

    const fx = await getSetting("fxRate"); // ARS por 1 USD
    if ((!fx || fx <= 0) && currency === "ARS") {
      return alert("Configurá el tipo de cambio (ARS por 1 USD) para cargar montos en ARS.");
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
      currency,
      amountOriginal: amount,
      amountARS,
      amountUSD,
      fxRateUsed: fx || null,
      date: todayISO(),
    };

    await addExpense(expense);

    $("amountInput").value = "";
    await updateConversionHint();
    await renderList();
  });

  await updateConversionHint();
  await renderList();
  await renderSummary();
  showView("expenses");
});
