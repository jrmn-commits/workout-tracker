import { useEffect, useMemo, useRef, useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";

/* ------------------------------- Types ----------------------------------- */
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
type Store = { units: "lb" | "kg"; sets: SetEntry[] };
const STORAGE_KEY = "workout_tracker_v1";

/* ------------------------------- Utils ----------------------------------- */
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);
const setVolume = (w: number, r: number) =>
  Number.isFinite(w) && Number.isFinite(r) ? w * r : 0;

/* --------------------------- Cloudflare KV Sync --------------------------- */
async function loadFromKV(): Promise<Store | null> {
  try {
    const r = await fetch("/sync");
    if (!r.ok) return null;
    return (await r.json()) as Store;
  } catch {
    return null;
  }
}

async function pushToKV(store: Store) {
  await fetch("/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
}

function mergeStores(a: Store, b: Store): Store {
  const ids = new Set(a.sets.map((s) => s.id));
  const merged = [...a.sets];
  for (const s of b.sets) if (!ids.has(s.id)) merged.push(s);
  merged.sort((x, y) => x.date.localeCompare(y.date));
  return { ...a, sets: merged };
}

async function syncToKV(local: Store) {
  try {
    const remote = await loadFromKV();
    if (remote) {
      const combined = mergeStores(remote, local);
      await pushToKV(combined);
    } else {
      await pushToKV(local);
    }
  } catch (err) {
    console.warn("KV sync failed:", err);
  }
}

/* -------------------------------- Component ------------------------------- */
export default function App() {
  // Service Worker
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // Store State
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

  // Sync on mount + interval
  useEffect(() => {
    (async () => {
      const cloud = await loadFromKV();
      if (cloud && cloud.sets.length > store.sets.length)
        setStore((local) => mergeStores(local, cloud));
    })();

    const id = setInterval(() => syncToKV(store), 15000);
    return () => clearInterval(id);
  }, [store]);

  /* ----------------------------- Form & Filters --------------------------- */
  const [form, setForm] = useState<SetEntry>({
    id: "",
    date: today(),
    exercise: "",
    category: "push",
    weight: 0,
    reps: 0,
  });

  /* -------------------------- High Score Board --------------------------- */
  type ExerciseStats = {
    exercise: string;
    maxWeight: number;
    maxReps: number;
  };

  const highScores: ExerciseStats[] = useMemo(() => {
    const byEx = new Map<string, ExerciseStats>();
    for (const s of store.sets) {
      const cur = byEx.get(s.exercise) ?? {
        exercise: s.exercise,
        maxWeight: 0,
        maxReps: 0,
      };
      if (s.weight > cur.maxWeight) cur.maxWeight = s.weight;
      if (s.reps > cur.maxReps) cur.maxReps = s.reps;
      byEx.set(s.exercise, cur);
    }
    return Array.from(byEx.values()).sort(
      (a, b) =>
        b.maxWeight - a.maxWeight ||
        b.maxReps - a.maxReps ||
        a.exercise.localeCompare(b.exercise)
    );
  }, [store.sets]);

  // NEW highlight
  const prevMaxRef = useRef<Map<string, { weight: number; reps: number }>>(
    new Map()
  );
  const [updated, setUpdated] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = Date.now();
    const next = { ...updated };
    const prev = prevMaxRef.current;
    for (const { exercise, maxWeight, maxReps } of highScores) {
      const p = prev.get(exercise);
      if (!p || maxWeight > p.weight || maxReps > p.reps) {
        next[exercise] = now;
        prev.set(exercise, { weight: maxWeight, reps: maxReps });
      }
    }
    setUpdated(next);
  }, [highScores]);

  // Expire NEW after 8s
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const copy = { ...updated };
      let changed = false;
      for (const [ex, t] of Object.entries(copy)) {
        if (now - t > 8000) {
          delete copy[ex];
          changed = true;
        }
      }
      if (changed) setUpdated(copy);
    }, 1000);
    return () => clearInterval(id);
  }, [updated]);

  /* ------------------------------ Actions -------------------------------- */
  function addSet() {
    if (!form.exercise || !form.weight || !form.reps) return;
    setStore((p) => ({
      ...p,
      sets: [...p.sets, { ...form, id: uid() }],
    }));
    setForm((f) => ({ ...f, weight: 0, reps: 0 }));
  }

  function deleteSet(id: string) {
    setStore((p) => ({ ...p, sets: p.sets.filter((s) => s.id !== id) }));
  }

  /* ------------------------------ Render -------------------------------- */
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Workout Tracker</h1>
          <p className="text-sm text-neutral-400">
            Merge-safe Cloudflare KV • Offline-first
          </p>
        </header>

        {/* Add Set */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">Add Set</h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-2"
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
            <button
              onClick={addSet}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
            >
              <PlusCircle className="h-4 w-4 mr-1" /> Add
            </button>
          </div>
        </section>

        {/* High Score Board */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 space-y-3">
          <h2 className="font-semibold">High Score Board</h2>
          <p className="text-xs text-neutral-400">
            Highest weight and reps per set
          </p>
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400 border-b border-neutral-800">
              <tr>
                <th className="py-2 pr-3 text-left">Exercise</th>
                <th className="py-2 pr-3 text-left">Max Weight</th>
                <th className="py-2 pr-3 text-left">Max Reps</th>
              </tr>
            </thead>
            <tbody>
              {highScores.map((h) => {
                const isNew = updated[h.exercise] != null;
                return (
                  <tr key={h.exercise} className="border-b border-neutral-900">
                    <td className="py-2 pr-3 flex items-center gap-2">
                      <span>{h.exercise}</span>
                      {isNew && (
                        <span className="glow-new animate-float">NEW</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {h.maxWeight} {store.units}
                    </td>
                    <td className="py-2 pr-3">{h.maxReps}</td>
                  </tr>
                );
              })}
              {!highScores.length && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-4 text-center text-neutral-500"
                  >
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* History */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
          <h2 className="font-semibold mb-2">History</h2>
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400 border-b border-neutral-800">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Exercise</th>
                <th className="py-2 pr-3">Weight</th>
                <th className="py-2 pr-3">Reps</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {store.sets.map((s) => (
                <tr key={s.id} className="border-b border-neutral-900">
                  <td className="py-2 pr-3">{s.date}</td>
                  <td className="py-2 pr-3">{s.exercise}</td>
                  <td className="py-2 pr-3">
                    {s.weight} {store.units}
                  </td>
                  <td className="py-2 pr-3">{s.reps}</td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => deleteSet(s.id)}
                      className="bg-red-600/80 hover:bg-red-600 text-white px-2 py-1 rounded"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
              {!store.sets.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-6 text-center text-neutral-500"
                  >
                    Add your first set above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <footer className="text-center text-xs text-neutral-500 py-4">
          Cloudflare KV Sync • Offline-first
        </footer>
      </div>
    </main>
  );
}
