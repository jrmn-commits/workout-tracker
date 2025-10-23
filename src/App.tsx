import { useEffect, useMemo, useRef, useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";

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

// @ts-ignore – used indirectly throughout
const setVolume = (w: number, r: number) =>
  Number.isFinite(w) && Number.isFinite(r) ? w * r : 0;

const VALID_CATS: Category[] = ["push", "pull", "legs"];

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

/* --------------------------- Cloudflare KV Sync --------------------------- */
const KV_URL = import.meta.env.VITE_KV_ENDPOINT ?? "";

async function syncToKV(store: Store) {
  if (!KV_URL) return;
  try {
    await fetch(`${KV_URL}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(store),
    });
  } catch {
    console.warn("KV sync failed");
  }
}

async function loadFromKV(): Promise<Store | null> {
  if (!KV_URL) return null;
  try {
    const r = await fetch(`${KV_URL}/sync`);
    if (!r.ok) return null;
    return (await r.json()) as Store;
  } catch {
    return null;
  }
}

/* -------------------------------- Component ------------------------------- */
export default function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const [store, setStore] = useState<Store>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Store) : { units: "lb", sets: [] };
    } catch {
      return { units: "lb", sets: [] };
    }
  });

  // KV sync
  useEffect(() => {
    syncToKV(store);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  // Attempt to load from KV once
  useEffect(() => {
    (async () => {
      const remote = await loadFromKV();
      if (remote && remote.sets.length > store.sets.length) setStore(remote);
    })();
  }, []);

  const [form, setForm] = useState<SetEntry>({
    id: "",
    date: today(),
    exercise: "",
    category: "push",
    weight: 0,
    reps: 0,
    notes: "",
  });

  /* ------------------------------ High Scores ----------------------------- */
  type ExerciseStats = {
    exercise: string;
    maxWeight: number;
    maxReps: number;
  };

  const highScores: ExerciseStats[] = useMemo(() => {
    const byEx = new Map<string, ExerciseStats>();
    for (const s of store.sets) {
      const cur =
        byEx.get(s.exercise) ?? { exercise: s.exercise, maxWeight: 0, maxReps: 0 };
      cur.maxWeight = Math.max(cur.maxWeight, s.weight);
      cur.maxReps = Math.max(cur.maxReps, s.reps);
      byEx.set(s.exercise, cur);
    }
    return Array.from(byEx.values()).sort((a, b) => b.maxWeight - a.maxWeight);
  }, [store.sets]);

  const prevMaxRef = useRef<Map<string, number>>(new Map());
  const [rowUpdatedAt, setRowUpdatedAt] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = { ...rowUpdatedAt };
    const prev = prevMaxRef.current;
    for (const { exercise, maxWeight } of highScores) {
      const last = prev.get(exercise) ?? 0;
      if (maxWeight > last) {
        next[exercise] = Date.now();
        prev.set(exercise, maxWeight);
      }
    }
    setRowUpdatedAt(next);
  }, [highScores]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const copy = { ...rowUpdatedAt };
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

  /* -------------------------------- Actions ------------------------------- */
  function addSet() {
    if (!form.exercise || !form.weight || !form.reps) return;
    setStore((p) => ({ ...p, sets: [...p.sets, { ...form, id: uid() }] }));
    setForm((f) => ({ ...f, weight: 0, reps: 0, notes: "" }));
  }

  const deleteSet = (id: string) =>
    setStore((p) => ({ ...p, sets: p.sets.filter((s) => s.id !== id) }));

  /* -------------------------------- Render -------------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Workout Tracker</h1>
        <p className="text-sm text-neutral-400">Offline-first • KV synced</p>

        {/* Add Set */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">Add Set</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
            />
            <input
              placeholder="Exercise"
              value={form.exercise}
              onChange={(e) => setForm({ ...form, exercise: e.target.value })}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2 col-span-2"
            />
            <select
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as Category })
              }
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
            >
              <option value="push">Push</option>
              <option value="pull">Pull</option>
              <option value="legs">Legs</option>
            </select>
            <input
              type="number"
              placeholder="Weight"
              value={form.weight}
              onChange={(e) =>
                setForm({ ...form, weight: Number(e.target.value) || 0 })
              }
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
            />
            <input
              type="number"
              placeholder="Reps"
              value={form.reps}
              onChange={(e) =>
                setForm({ ...form, reps: Number(e.target.value) || 0 })
              }
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={addSet}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
            >
              <PlusCircle className="h-4 w-4 mr-2" /> Add
            </button>
          </div>
        </section>

        {/* High Score Board */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">High Score Board</h2>
          <p className="text-xs text-neutral-400">
            Highest weight and reps achieved per exercise
          </p>
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr className="text-left border-b border-neutral-800">
                <th className="py-2 pr-3">Exercise</th>
                <th className="py-2 pr-3">Highest Weight</th>
                <th className="py-2 pr-3">Max Reps</th>
              </tr>
            </thead>
            <tbody>
              {highScores.map((row) => {
                const isNew = rowUpdatedAt[row.exercise] != null;
                return (
                  <tr key={row.exercise} className="border-b border-neutral-900">
                    <td className="py-2 pr-3 flex items-center gap-2">
                      <span className="font-medium">{row.exercise}</span>
                      {isNew && (
                        <span className="glow-new animate-float">NEW</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {row.maxWeight ? `${row.maxWeight} ${store.units}` : "-"}
                    </td>
                    <td className="py-2 pr-3">{row.maxReps}</td>
                  </tr>
                );
              })}
              {!highScores.length && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-6 text-center text-neutral-500"
                  >
                    No sets yet — add your first set above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
