const BASE = "/api";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function req(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    signal,
  });

  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* не JSON — оставляем дефолт */
    }
    throw new ApiError(message, res.status);
  }

  const type = res.headers.get("content-type") ?? "";
  return type.includes("application/json") ? res.json() : res.text();
}

export const get = (path, opts) => req(path, opts);
export const post = (path, body, opts) => req(path, { ...opts, method: "POST", body });
export const patch = (path, body, opts) => req(path, { ...opts, method: "PATCH", body });
export const del = (path, opts) => req(path, { ...opts, method: "DELETE" });

/** Староста или его заместитель — видят админ-блоки */
export const isStaff = (me) => me?.user?.role === "starosta" || me?.user?.role === "deputy";
export const isStarosta = (me) => me?.user?.role === "starosta";

/** Подписка на live-события группы */
export function subscribe(handlers) {
  const es = new EventSource(`${BASE}/events`);
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch {
        /* игнорируем битые события */
      }
    });
  }
  return () => es.close();
}

export const STATUS = {
  going: { label: "Иду", short: "Иду", emoji: "✅", color: "var(--ok)" },
  late: { label: "Опоздаю", short: "Опоздаю", emoji: "⏰", color: "var(--warn)" },
  absent: { label: "Не иду", short: "Не иду", emoji: "🚫", color: "var(--bad)" },
  sick: { label: "Уважительная", short: "Уваж.", emoji: "🤒", color: "var(--info)" },
};
