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
  date: string;
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

  /* ---------------------- High Score Board ---------------------- */
  type ExerciseStats = {
    exercise: string;
    maxWeight: number;
    maxReps: number; // highest reps in a single set
    totalTonnage: number;
  };

  const highScores: ExerciseStats[] = useMemo(() => {
    const byEx = new Map<string, ExerciseStats>();
    for (const s of store.sets) {
      const cur = byEx.get(s.exercise) ?? { exercise: s.exercise, maxWeight: 0, maxReps: 0, totalTonnage: 0 };
      if (s.reps > cur.maxReps) cur.maxReps = s.reps;
      cur.totalTonnage += setVolume(s.weight, s.reps);
      if (s.weight > cur.maxWeight) cur.maxWeight = s.weight;
      byEx.set(s.exercise, cur);
    }
    const arr = Array.from(byEx.values());
    arr.sort((a, b) => b.maxWeight - a.maxWeight || b.maxReps - a.maxReps || a.exercise.localeCompare(b.exercise));
    return arr;
  }, [store.sets]);

  // Track "NEW" animation
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
    setRowUpdatedAt(nextUpdated);
  }, [highScores]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const copy: Record<string, number> = { ...rowUpdatedAt };
      let changed = false;
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

  /* ------------------------------ Render ---------------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Workout Tracker</h1>
          <button onClick={() => navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))} className="text-xs text-neutral-400">
            Reset SW
          </button>
        </header>

        {/* Add Set */}
        <section className="border border-neutral-800 rounded-2xl bg-neutral-950/70 p-4">
          <h2 className="font-semibold mb-3">Add Set</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input placeholder="Exercise" value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            <input type="number" placeholder="Weight" value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
            <input type="number" placeholder="Reps" value={form.reps} onChange={(e) => setForm({ ...form, reps: Number(e.target.value) })} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2" />
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={addSet} className="inline-flex items-center bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md">
              <PlusCircle className="h-4 w-4 mr-1" /> Add
            </button>
          </div>
        </section>

        {/* High Score Board */}
        <section className="border border-neutral-800 rounded-2xl bg-neutral-950/70 p-4">
          <h2 className="font-semibold mb-3">High Score Board</h2>
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400 border-b border-neutral-800">
              <tr>
                <th className="text-left py-2">Exercise</th>
                <th className="text-left py-2">Highest Weight</th>
                <th className="text-left py-2">Max Reps (1 set)</th>
                <th className="text-left py-2">Total Tonnage</th>
              </tr>
            </thead>
            <tbody>
              {highScores.length ? (
                highScores.map((row) => {
                  const isNew = rowUpdatedAt[row.exercise] != null;
                  return (
                    <tr key={row.exercise} className="border-b border-neutral-900">
                      <td className="py-2 pr-3 flex items-center gap-2">
                        <span className="font-medium">{row.exercise}</span>
                        {isNew && <span className="glow-new animate-float">NEW</span>}
                      </td>
                      <td className="py-2 pr-3">{row.maxWeight} {store.units}</td>
                      <td className="py-2 pr-3">{row.maxReps}</td>
                      <td className="py-2 pr-3">{Math.round(row.totalTonnage)} {store.units}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={4} className="text-center text-neutral-500 py-4">No sets yet — add one above.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <footer className="text-center text-xs text-neutral-500">Offline-first • Local storage • Export coming soon</footer>
      </div>
    </main>
  );
}
