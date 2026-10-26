import { useRef, useState } from "react";
import { get, del } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox } from "../ui.jsx";

const MAX_MB = 40;

function humanSize(bytes) {
  if (!bytes) return "0 Б";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const dateRu = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

export default function Files({ me, notify }) {
  const files = useFetch(() => get("/files"), []);
  const subjects = useFetch(() => get("/subjects"), []);
  const [busy, setBusy] = useState(null);
  const inputs = useRef({});

  const isAdmin = me.user.role === "starosta";

  async function upload(subjectId, file) {
    if (!file) return;

    if (file.size > MAX_MB * 1024 * 1024) {
      notify(`Файл больше ${MAX_MB} МБ`, "err");
      return;
    }

    const key = subjectId ?? "none";
    setBusy(key);
    try {
      const qs = new URLSearchParams({ name: file.name });
      if (subjectId) qs.set("subjectId", String(subjectId));

      const res = await fetch(`/api/files?${qs}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
        credentials: "same-origin",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Ошибка ${res.status}`);
      }

      notify(`Загружено: ${file.name}`);
      files.reload();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(null);
      if (inputs.current[key]) inputs.current[key].value = "";
    }
  }

  async function remove(id) {
    try {
      await del(`/files/${id}`);
      files.reload();
      notify("Файл удалён");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  if (files.loading && !files.data) return <Spinner text="Загружаем файлы" />;
  if (files.error) return <ErrorBox message={files.error} onRetry={files.reload} />;

  const all = files.data ?? [];
  const totalSize = all.reduce((n, f) => n + (f.size ?? 0), 0);

  const groups = [
    ...(subjects.data ?? []).map((s) => ({
      key: String(s.id),
      subjectId: s.id,
      name: s.name,
      color: s.color,
      items: all.filter((f) => f.subject_id === s.id),
    })),
    {
      key: "none",
      subjectId: null,
      name: "Общие файлы",
      color: "#8a93a8",
      items: all.filter((f) => !f.subject_id),
    },
  ]
    .filter((g) => g.items.length > 0 || g.subjectId !== null)
    .sort((a, b) => b.items.length - a.items.length);

  return (
    <>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, letterSpacing: "-0.03em" }}>Полезные файлы</h1>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Учебники, конспекты, методички · {all.length} шт · {humanSize(totalSize)} · до {MAX_MB} МБ на файл
      </p>

      {groups.map((g) => (
        <div className="section" key={g.key}>
          <div className="section-head">
            <h2 style={{ color: g.color }}>{g.name}</h2>
            <button
              type="button"
              className="link"
              onClick={() => inputs.current[g.key]?.click()}
              disabled={busy === g.key}
            >
              {busy === g.key ? "загружаю…" : "+ файл"}
            </button>
          </div>

          <input
            ref={(el) => {
              inputs.current[g.key] = el;
            }}
            type="file"
            hidden
            onChange={(e) => upload(g.subjectId, e.target.files?.[0])}
          />

          {g.items.length === 0 ? (
            <div className="tiny muted" style={{ padding: "2px 2px 6px" }}>
              пока пусто
            </div>
          ) : (
            <div className="card" style={{ padding: "4px 14px" }}>
              {g.items.map((f) => (
                <div key={f.id} className="file-row">
                  <span className="file-icon">
                    <Icon name="book" size={15} />
                  </span>

                  <div className="file-body">
                    <a className="file-name" href={`/api/files/${f.id}/download`}>
                      {f.name}
                    </a>
                    <div className="file-meta">
                      {humanSize(f.size)} · {f.uploader_name ?? "—"} · {dateRu(f.created_at)}
                    </div>
                  </div>

                  {(isAdmin || f.uploader_id === me.user.id) && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => remove(f.id)}
                      aria-label={`Удалить ${f.name}`}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
