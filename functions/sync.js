export async function onRequestGet({ env }) {
  try {
    const data = await env.WORKOUT_KV.get("store", { type: "json" });
    return new Response(JSON.stringify(data || { units: "lb", sets: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    await env.WORKOUT_KV.put("store", JSON.stringify(body));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
