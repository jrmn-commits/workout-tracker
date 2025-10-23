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

  const tonnageFormatter: TooltipProps<number, string>["formatter"] = (...args) => {
    const props = args[2] as any;
    return [`${props?.payload?.tonnage ?? 0} ${store.units}`, "Tonnage"];
  };

  /* ---------------------- High Score Board (per exercise) ------------------ */
  type ExerciseStats = {
    exercise: string;
    maxWeight: number;
    totalReps: number;
    totalTonnage: number;
  };

  const highScores: ExerciseStats[] = useMemo(() => {
    const byEx = new Map<string, ExerciseStats>();
    for (const s of store.sets) {
      const cur =
        byEx.get(s.exercise) ?? { exercise: s.exercise, maxWeight: 0, totalReps: 0, totalTonnage: 0 };
      cur.totalReps += s.reps;
      cur.totalTonnage += setVolume(s.weight, s.reps);
      if (s.weight > cur.maxWeight) cur.maxWeight = s.weight;
      byEx.set(s.exercise, cur);
    }
    const arr = Array.from(byEx.values());
    arr.sort(
      (a, b) =>
        b.maxWeight - a.maxWeight ||
        b.totalReps - a.totalReps ||
        a.exercise.localeCompare(b.exercise)
    );
    return arr;
  }, [store.sets]);

  const prevMaxRef = useRef<Map<string, number>>(new Map());
  const [rowUpdatedAt, setRowUpdatedAt] = useState<Record<string, number>>({});

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
    for (const k of Array.from(prev.keys())) {
      if (!highScores.find((h) => h.exercise === k)) {
        prev.delete(k);
        delete nextUpdated[k];
      }
    }
    setRowUpdatedAt(nextUpdated);
  }, [highScores]);

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

  /* ----------------------------- Render ----------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <style>{`
        @keyframes floatNew {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .glow-new {
          @apply inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 ring-2 ring-amber-400/50;
          animation: floatNew 1.5s ease-in-out infinite;
        }
      `}</style>
      <div className="max-w-6xl mx-auto space-y-6">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">High Score Board — per exercise</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-neutral-400">
                <tr className="text-left border-b border-neutral-800">
                  <th className="py-2 pr-3">Exercise</th>
                  <th className="py-2 pr-3">Highest weight</th>
                  <th className="py-2 pr-3">Reps moved</th>
                  <th className="py-2 pr-3">Total tonnage</th>
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
                        <td className="py-2 pr-3">{row.totalReps}</td>
                        <td className="py-2 pr-3">
                          {Math.round(row.totalTonnage)} {store.units}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-neutral-500">
                      No data yet — add your first set above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
