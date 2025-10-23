import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, PlusCircle, Trash2, Printer } from "lucide-react";
import type { TooltipProps } from "recharts";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

/* ---------------------------------- Types --------------------------------- */
type Category = "push" | "pull" | "legs";

type SetEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  exercise: string;
  category: Category;
  weight: number;
  reps: number;
  rpe?: number;
  notes?: string;
};

type Store = {
  units: "lb" | "kg";
  sets: SetEntry[];
};

const STORAGE_KEY = "workout_tracker_v1";

/* --------------------------------- Utils ---------------------------------- */
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);
const setVolume = (w: number, r: number) => (Number.isFinite(w) && Number.isFinite(r) ? w * r : 0);
function e1rm(weight: number, reps: number) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

/* --------------------------- CSV parsing helpers -------------------------- */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cur.trim());
        cur = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur.trim());
        if (row.some((c) => c !== "")) rows.push(row);
        row = [];
        cur = "";
      } else cur += ch;
    }
  }
  row.push(cur.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
const VALID_CATS: Category[] = ["push", "pull", "legs"];
function rowsToSets(rows: string[][], targetUnits: Store["units"]) {
  const errors: string[] = [];
  if (!rows.length) return { sets: [], errors: ["CSV is empty"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const dateI = idx("date"),
    exI = idx("exercise"),
    catI = idx("category"),
    wI = idx("weight"),
    rI = idx("reps"),
    rpeI = idx("rpe"),
    notesI = idx("notes"),
    unitsI = idx("units");
  const miss = [dateI, exI, catI, wI, rI].some((x) => x < 0);
  if (miss) return { sets: [], errors: ["Missing required columns"] };
  const out: SetEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const date = row[dateI]?.trim();
    const exercise = row[exI]?.trim();
    const category = row[catI]?.trim().toLowerCase() as Category;
    const weightRaw = Number(row[wI]);
    const repsRaw = Number(row[rI]);
    const rpe = rpeI >= 0 && row[rpeI] ? Number(row[rpeI]) : undefined;
    const notes = notesI >= 0 ? row[notesI] ?? "" : "";
    const csvUnits = (unitsI >= 0 ? row[unitsI] : "").trim().toLowerCase() as "lb" | "kg" | "";
    if (!date || !exercise || !VALID_CATS.includes(category) || !Number.isFinite(weightRaw) || !Number.isFinite(repsRaw)) {
      errors.push(`Row ${r + 1}: invalid data`);
      continue;
    }
    let weight = weightRaw;
    const rowUnits = csvUnits || targetUnits;
    if (rowUnits !== targetUnits) {
      if (rowUnits === "kg" && targetUnits === "lb") weight *= 2.2046226218;
      if (rowUnits === "lb" && targetUnits === "kg") weight /= 2.2046226218;
    }
    out.push({ id: uid(), date, exercise, category, weight: Number(weight.toFixed(2)), reps: repsRaw, rpe, notes });
  }
  return { sets: out, errors };
}

/* -------------------------------- Component ------------------------------- */
export default function App() {
  // PWA registration
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const [store, setStore] = useState<Store>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Store) : { units: "lb", sets: [] };
    } catch {
      return { units: "lb", sets: [] };
    }
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const [form, setForm] = useState<SetEntry>({
    id: "",
    date: today(),
    exercise: "",
    category: "push",
    weight: 0,
    reps: 0,
    rpe: undefined,
    notes: "",
  });
  const [exerciseFilter, setExerciseFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  /* ------------------------------- Derived -------------------------------- */
  const exercises = useMemo(
    () => Array.from(new Set(store.sets.map((s) => s.exercise))).filter(Boolean),
    [store.sets]
  );

  const filtered = useMemo(
    () =>
      store.sets
        .filter((s) => (exerciseFilter ? s.exercise === exerciseFilter : true))
        .filter((s) => (dateFrom ? s.date >= dateFrom : true))
        .filter((s) => (dateTo ? s.date <= dateTo : true))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [store.sets, exerciseFilter, dateFrom, dateTo]
  );

  const totals = useMemo(() => {
    const t = filtered.reduce(
      (acc, s) => {
        acc.sets++;
        acc.tonnage += setVolume(s.weight, s.reps);
        acc.avgRPE += s.rpe ?? 0;
        return acc;
      },
      { sets: 0, tonnage: 0, avgRPE: 0 }
    );
    if (t.sets) t.avgRPE /= t.sets;
    return t;
  }, [filtered]);

  const chartData = useMemo(() => {
    if (!exerciseFilter) return [];
    const map = new Map<string, number>();
    for (const s of filtered.filter((x) => x.exercise === exerciseFilter)) {
      const est = e1rm(s.weight, s.reps);
      map.set(s.date, Math.max(map.get(s.date) ?? 0, est));
    }
    return Array.from(map.entries())
      .map(([date, e1RM]) => ({ date, e1RM: Number(e1RM.toFixed(1)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, exerciseFilter]);

  const wheelData = useMemo(() => {
    const sums: Record<Category, number> = { push: 0, pull: 0, legs: 0 };
    for (const s of filtered) sums[s.category] += setVolume(s.weight, s.reps);
    const max = Math.max(1, ...Object.values(sums));
    const scale = (v: number) => Number(((v / max) * 10).toFixed(2));
    return [
      { cat: "Push", score: scale(sums.push), tonnage: Math.round(sums.push) },
      { cat: "Pull", score: scale(sums.pull), tonnage: Math.round(sums.pull) },
      { cat: "Legs", score: scale(sums.legs), tonnage: Math.round(sums.legs) },
    ];
  }, [filtered]);

  // Recharts tooltip formatter (no unused params)
  const tonnageFormatter: TooltipProps<number, string>["formatter"] = (...args) => {
    const props = args[2] as any;
    return [`${props?.payload?.tonnage ?? 0} ${store.units}`, "Tonnage"];
  };

  /* ---------------------- High Score Board (per exercise) ------------------ */
  type ExerciseStats = {
    exercise: string;
    maxWeight: number;   // best single-set weight
    totalSets: number;   // total sets logged for that exercise
    totalTonnage: number;// sum of weight*reps (not shown, but available)
  };

  const highScores: ExerciseStats[] = useMemo(() => {
    const byEx = new Map<string, ExerciseStats>();
    for (const s of store.sets) {
      const cur = byEx.get(s.exercise) ?? { exercise: s.exercise, maxWeight: 0, totalSets: 0, totalTonnage: 0 };
      cur.totalSets += 1;
      cur.totalTonnage += setVolume(s.weight, s.reps);
      if (s.weight > cur.maxWeight) cur.maxWeight = s.weight;
      byEx.set(s.exercise, cur);
    }
    const arr = Array.from(byEx.values());
    // Sort primarily by maxWeight desc, then by totalSets desc, then name
    arr.sort((a, b) => (b.maxWeight - a.maxWeight) || (b.totalSets - a.totalSets) || a.exercise.localeCompare(b.exercise));
    return arr;
  }, [store.sets]);

  // Track "NEW" badges per exercise when maxWeight increases
  const prevMaxRef = useRef<Map<string, number>>(new Map());
  const [rowUpdatedAt, setRowUpdatedAt] = useState<Record<string, number>>({}); // exercise -> timestamp

  useEffect(() => {
    const nextUpdated: Record<string, number> = { ...rowUpdatedAt };
    const prev = prevMaxRef.current;
    for (const { exercise, maxWeight } of highScores) {
      const last = prev.get(exercise) ?? 0;
      if (maxWeight > last) {
        nextUpdated[exercise] = Date.now();
        prev.set(exercise, maxWeight);
      }
    }
    // Clean out exercises removed from data
    for (const k of Array.from(prev.keys())) {
      if (!highScores.find((h) => h.exercise === k)) {
        prev.delete(k);
        delete nextUpdated[k];
      }
    }
    setRowUpdatedAt(nextUpdated);
  }, [highScores]); // update when scores change

  // Auto-hide NEW after 8s
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const copy: Record<string, number> = { ...rowUpdatedAt };
      for (const [k, ts] of Object.entries(copy)) {
        if (now - ts > 8000) {
          delete copy[k];
          changed = true;
        }
      }
      if (changed) setRowUpdatedAt(copy);
    }, 1000);
    return () => clearInterval(id);
  }, [rowUpdatedAt]);

  /* ------------------------------- Actions -------------------------------- */
  function addSet() {
    if (!form.exercise || !form.weight || !form.reps) return;
    setStore((p) => ({ ...p, sets: [...p.sets, { ...form, id: uid() }] }));
    setForm((f) => ({ ...f, weight: 0, reps: 0, rpe: undefined, notes: "" }));
  }
  const deleteSet = (id: string) =>
    setStore((p) => ({ ...p, sets: p.sets.filter((s) => s.id !== id) }));

  function exportJSON() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workouts.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Store;
        if (!parsed || !Array.isArray(parsed.sets)) throw new Error("Invalid format");
        setStore(parsed);
      } catch (err) {
        alert(`Import failed: ${err}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const { sets, errors } = rowsToSets(parseCSV(text), store.units);
      if (sets.length) {
        setStore((prev) => ({ ...prev, sets: [...prev.sets, ...sets] }));
      }
      if (errors.length) alert(`CSV warnings:\n- ${errors.join("\n- ")}`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function exportCSV() {
    const headers = ["date", "exercise", "category", "weight", "reps", "rpe", "notes", "units"];
    const rows = store.sets.map((s) => [
      s.date,
      s.exercise,
      s.category,
      s.weight,
      s.reps,
      s.rpe ?? "",
      s.notes ?? "",
      store.units,
    ]);
    const csv = [headers, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const val = String(v ?? "");
            return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
          })
          .join(",")
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "workouts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const printPage = () => window.print();

  /* ----------------------------- Render ----------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Workout Tracker</h1>
              <p className="text-sm text-neutral-400">Monthly training log • e1RM trend • PPL balance • Exports</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={printPage} className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-sm" title="Print dashboard">
                <Printer className="h-4 w-4" /> Print
              </button>
              <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-sm" title="Download CSV">
                <Download className="h-4 w-4" /> CSV
              </button>
              <button onClick={exportJSON} className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-sm" title="Download JSON">
                <Download className="h-4 w-4" /> JSON
              </button>
              <div>
                <input id="jsonFile" type="file" accept="application/json" className="hidden" onChange={importJSON} />
                <label htmlFor="jsonFile" className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-sm" title="Import workouts (JSON)">
                  <Upload className="h-4 w-4" /> Import JSON
                </label>
              </div>
              <div>
                <input id="csvFile" type="file" accept=".csv,text/csv" className="hidden" onChange={importCSV} />
                <label htmlFor="csvFile" className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-sm" title="Import workouts (CSV)">
                  <Upload className="h-4 w-4" /> Import CSV
                </label>
              </div>
            </div>
          </div>

          {/* Slim controls row */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex gap-2 items-center">
              <span className="text-xs text-neutral-400">Units</span>
              <select
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={store.units}
                onChange={(e) => setStore((s) => ({ ...s, units: e.target.value as Store["units"] }))}
              >
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div className="flex gap-2">
              <div>
                <label className="block mb-1 text-neutral-300 text-xs">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="block mb-1 text-neutral-300 text-xs">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="block mb-1 text-neutral-300 text-xs">Exercise</label>
                <select value={exerciseFilter} onChange={(e) => setExerciseFilter(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm min-w-48">
                  <option value="">All exercises</option>
                  {exercises.map((ex) => (
                    <option key={ex} value={ex}>
                      {ex}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        {/* Add Set */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">Add Set</h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-3">
              <label className="block mb-1 text-neutral-300">Exercise</label>
              <input placeholder="e.g., Bench Press" value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2">
                <option value="push">Push</option>
                <option value="pull">Pull</option>
                <option value="legs">Legs</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Weight ({store.units})</label>
              <input type="number" min={0} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) || 0 })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-1">
              <label className="block mb-1 text-neutral-300">Reps</label>
              <input type="number" min={1} value={form.reps} onChange={(e) => setForm({ ...form, reps: Number(e.target.value) || 0 })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">RPE</label>
              <input type="number" step={0.5} min={5} max={10} value={form.rpe ?? ""} onChange={(e) => setForm({ ...form, rpe: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-12">
              <label className="block mb-1 text-neutral-300">Notes</label>
              <input placeholder="tempo, cues, pain, etc." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={addSet} className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white">
              <PlusCircle className="h-4 w-4 mr-2" /> Add Set
            </button>
          </div>
        </section>

        {/* High Score Board */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">High Score Board — per exercise</h2>
            <span className="text-xs text-neutral-400">Highest weight • Sets moved</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-neutral-400">
                <tr className="text-left border-b border-neutral-800">
                  <th className="py-2 pr-3">Exercise</th>
                  <th className="py-2 pr-3">Highest weight</th>
                  <th className="py-2 pr-3">Sets moved</th>
                </tr>
              </thead>
              <tbody>
                {highScores.length ? (
                  highScores.map((row) => {
                    const isNew = rowUpdatedAt[row.exercise] != null;
                    return (
                      <tr key={row.exercise} className="border-b border-neutral-900">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{row.exercise}</span>
                            {isNew && <span className="glow-new">NEW</span>}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          {row.maxWeight ? `${row.maxWeight} ${store.units}` : "-"}
                        </td>
                        <td className="py-2 pr-3">{row.totalSets}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-neutral-500">
                      No data yet — add your first set above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Filters + Totals */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block mb-1 text-neutral-300">Exercise filter</label>
              <select className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" value={exerciseFilter} onChange={(e) => setExerciseFilter(e.target.value)}>
                <option value="">All exercises</option>
                {exercises.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block mb-1 text-neutral-300">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-3">
              <label className="block mb-1 text-neutral-300">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            </div>
            <div className="md:col-span-2">
              <div className="text-sm text-neutral-400">Totals</div>
              <div className="text-xs text-neutral-500">
                Sets: <span className="text-neutral-200">{totals.sets}</span> • Tonnage:{" "}
                <span className="text-neutral-200">{Math.round(totals.tonnage)} {store.units}</span>{" "}
                • Avg RPE: <span className="text-neutral-200">{totals.avgRPE ? totals.avgRPE.toFixed(1) : "-"}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Progress chart */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
            <h2 className="font-semibold">Progress — Best e1RM per Day{exerciseFilter ? ` (${exerciseFilter})` : ""}</h2>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="e1RM" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!exerciseFilter && <p className="text-xs text-neutral-500">Tip: choose an exercise to see its e1RM trend.</p>}
          </div>

          {/* Wheel: Push / Pull / Legs */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
            <h2 className="font-semibold">Push / Pull / Legs — Balance Wheel</h2>
            <p className="text-xs text-neutral-500">Each spoke shows relative tonnage (scaled 0–10). Hover for exact tonnage in {store.units}.</p>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={wheelData} outerRadius={110}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="cat" tick={{ fill: "#d4d4d8", fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                  <Tooltip formatter={tonnageFormatter} labelFormatter={(label: string) => String(label)} />
                  <Radar name="Balance" dataKey="score" stroke="#34d399" fill="#34d399" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-neutral-400">
                <tr className="text-left border-b border-neutral-800">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Exercise</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Weight</th>
                  <th className="py-2 pr-3">Reps</th>
                  <th className="py-2 pr-3">RPE</th>
                  <th className="py-2 pr-3">e1RM</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-neutral-900">
                    <td className="py-2 pr-3">{s.date}</td>
                    <td className="py-2 pr-3">{s.exercise}</td>
                    <td className="py-2 pr-3 capitalize">{s.category}</td>
                    <td className="py-2 pr-3">{s.weight} {store.units}</td>
                    <td className="py-2 pr-3">{s.reps}</td>
                    <td className="py-2 pr-3">{s.rpe ?? "-"}</td>
                    <td className="py-2 pr-3">{e1rm(s.weight, s.reps).toFixed(1)}</td>
                    <td className="py-2 pr-3">{s.notes}</td>
                    <td className="py-2 pr-3">
                      <button className="inline-flex items-center px-2 py-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white" onClick={() => deleteSet(s.id)} title="Delete set">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-neutral-500">No sets yet — add your first set above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="text-center text-xs text-neutral-500 py-4">
          Offline-first • Data stored locally • Export/Import anytime
        </footer>
      </div>
    </main>
  );
}
