import React, { useEffect, useMemo, useState } from "react";
import { Download, Upload, PlusCircle, Trash2 } from "lucide-react";
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

/** Epley e1RM: weight * (1 + reps/30) */
function e1rm(weight: number, reps: number) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

/** Tonnage for a set */
const setVolume = (w: number, r: number) => (Number.isFinite(w) && Number.isFinite(r) ? w * r : 0);

/* ------------------------------- Component -------------------------------- */
export default function App() {
  // PWA: register service worker if present
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Local store
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

  // Add-set form
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

  // Filters
  const [exerciseFilter, setExerciseFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Derived
  const exercises = useMemo(() => {
    const set = new Set(store.sets.map((s) => s.exercise).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [store.sets]);

  const filtered = useMemo(() => {
    return store.sets
      .filter((s) => (exerciseFilter ? s.exercise === exerciseFilter : true))
      .filter((s) => (dateFrom ? s.date >= dateFrom : true))
      .filter((s) => (dateTo ? s.date <= dateTo : true))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [store.sets, exerciseFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const t = filtered.reduce(
      (acc, s) => {
        acc.sets += 1;
        acc.tonnage += setVolume(s.weight, s.reps);
        acc.avgRPE += s.rpe ?? 0;
        return acc;
      },
      { sets: 0, tonnage: 0, avgRPE: 0 }
    );
    if (t.sets) t.avgRPE = t.avgRPE / t.sets;
    return t;
  }, [filtered]);

  // Chart: best e1RM per date for selected exercise
  const chartData = useMemo(() => {
    if (!exerciseFilter) return [];
    const byDate = new Map<string, number>();
    for (const s of filtered.filter((x) => x.exercise === exerciseFilter)) {
      const est = e1rm(s.weight, s.reps);
      const cur = byDate.get(s.date) ?? 0;
      if (est > cur) byDate.set(s.date, est);
    }
    return Array.from(byDate.entries())
      .map(([date, value]) => ({ date, e1RM: Number(value.toFixed(1)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, exerciseFilter]);

  // Wheel: category balance (tonnage per category, scaled 0–10)
  const wheelRaw = useMemo(() => {
    const sums: Record<Category, number> = { push: 0, pull: 0, legs: 0 };
    for (const s of filtered) {
      sums[s.category] += setVolume(s.weight, s.reps);
    }
    return sums;
  }, [filtered]);

  const wheelData = useMemo(() => {
    const max = Math.max(1, wheelRaw.push, wheelRaw.pull, wheelRaw.legs);
    const scale = (v: number) => Number(((v / max) * 10).toFixed(2));
    return [
      { cat: "Push", score: scale(wheelRaw.push), tonnage: Math.round(wheelRaw.push) },
      { cat: "Pull", score: scale(wheelRaw.pull), tonnage: Math.round(wheelRaw.pull) },
      { cat: "Legs", score: scale(wheelRaw.legs), tonnage: Math.round(wheelRaw.legs) },
    ];
  }, [wheelRaw]);

  /* ------------------------------- Actions -------------------------------- */
  function addSet() {
    if (!form.exercise || !form.date || !form.reps || !form.weight) return;
    const entry: SetEntry = { ...form, id: uid() };
    setStore((prev) => ({ ...prev, sets: [...prev.sets, entry] }));
    setForm((f) => ({ ...f, weight: 0, reps: 0, rpe: undefined, notes: "" }));
  }

  function deleteSet(id: string) {
    setStore((prev) => ({ ...prev, sets: prev.sets.filter((s) => s.id !== id) }));
  }

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

  /* -------------------------------- Render -------------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Workout Tracker</h1>
            <p className="text-sm text-neutral-400">Log sets • Track e1RM • Monitor tonnage & RPE</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
            <button
              onClick={exportJSON}
              className="inline-flex items-center px-3 py-2 rounded-md border border-neutral-700 hover:bg-neutral-800 text-sm"
            >
              <Download className="h-4 w-4 mr-2" /> Export
            </button>
            <div>
              <input id="jsonFile" type="file" accept="application/json" className="hidden" onChange={importJSON} />
              <label
                htmlFor="jsonFile"
                className="cursor-pointer inline-flex items-center px-3 py-2 rounded-md border border-neutral-700 hover:bg-neutral-800 text-sm"
              >
                <Upload className="h-4 w-4 mr-2" /> Import
              </label>
            </div>
          </div>
        </header>

        {/* Add Set */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
          <h2 className="font-semibold">Add Set</h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block mb-1 text-neutral-300">Exercise</label>
              <input
                placeholder="e.g., Bench Press"
                value={form.exercise}
                onChange={(e) => setForm({ ...form, exercise: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              >
                <option value="push">Push</option>
                <option value="pull">Pull</option>
                <option value="legs">Legs</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">Weight ({store.units})</label>
              <input
                type="number"
                min={0}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: Number(e.target.value) || 0 })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block mb-1 text-neutral-300">Reps</label>
              <input
                type="number"
                min={1}
                value={form.reps}
                onChange={(e) => setForm({ ...form, reps: Number(e.target.value) || 0 })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block mb-1 text-neutral-300">RPE</label>
              <input
                type="number"
                step={0.5}
                min={5}
                max={10}
                value={form.rpe ?? ""}
                onChange={(e) => setForm({ ...form, rpe: e.target.value === "" ? undefined : Number(e.target.value) })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-12">
              <label className="block mb-1 text-neutral-300">Notes</label>
              <input
                placeholder="tempo, cues, pain, etc."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={addSet}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
            >
              <PlusCircle className="h-4 w-4 mr-2" /> Add Set
            </button>
          </div>
        </section>

        {/* Filters + Totals */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block mb-1 text-neutral-300">Exercise filter</label>
              <select
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
                value={exerciseFilter}
                onChange={(e) => setExerciseFilter(e.target.value)}
              >
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
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block mb-1 text-neutral-300">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-sm text-neutral-400">Totals</div>
              <div className="text-xs text-neutral-500">
                Sets: <span className="text-neutral-200">{totals.sets}</span> • Tonnage:{" "}
                <span className="text-neutral-200">
                  {Math.round(totals.tonnage)} {store.units}
                </span>{" "}
                • Avg RPE: <span className="text-neutral-200">{totals.avgRPE ? totals.avgRPE.toFixed(1) : "-"}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Charts: e1RM progress + PPL Wheel */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Progress chart */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
            <h2 className="font-semibold">
              Progress — Best e1RM per Day{exerciseFilter ? ` (${exerciseFilter})` : ""}
            </h2>
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
            {!exerciseFilter && (
              <p className="text-xs text-neutral-500">Tip: choose an exercise to see its e1RM trend.</p>
            )}
          </div>

          {/* Wheel: Push / Pull / Legs */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
            <h2 className="font-semibold">Push / Pull / Legs — Balance Wheel</h2>
            <p className="text-xs text-neutral-500">
              Each spoke shows relative tonnage (scaled 0–10). Hover for exact tonnage in {store.units}.
            </p>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={wheelData} outerRadius={110}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="cat" tick={{ fill: "#d4d4d8", fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                  <Tooltip
                    formatter={(_, name, props: any) => {
                      // show tonnage in tooltip
                      return [`${props.payload.tonnage} ${store.units}`, "Tonnage"];
                    }}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Radar name="Balance" dataKey="score" stroke="#34d399" fill="#34d399" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
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
                    <td className="py-2 pr-3">
                      {s.weight} {store.units}
                    </td>
                    <td className="py-2 pr-3">{s.reps}</td>
                    <td className="py-2 pr-3">{s.rpe ?? "-"}</td>
                    <td className="py-2 pr-3">{e1rm(s.weight, s.reps).toFixed(1)}</td>
                    <td className="py-2 pr-3">{s.notes}</td>
                    <td className="py-2 pr-3">
                      <button
                        className="inline-flex items-center px-2 py-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white"
                        onClick={() => deleteSet(s.id)}
                        title="Delete set"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-neutral-500">
                      No sets yet — add your first set above.
                    </td>
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
