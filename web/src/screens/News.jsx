import { useEffect, useState } from "react";
import { get, post, del, subscribe } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox, Empty, Sheet, Avatar } from "../ui.jsx";
import { dayNumber, monthShort, parseIso } from "../dates.js";

export default function News({ me, notify }) {
  const ann = useFetch(() => get("/announcements"), []);
  const dl = useFetch(() => get("/deadlines"), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = me.user.role === "starosta";

  useEffect(
    () =>
      subscribe({
        announcement: () => ann.reload(),
      }),
    []
  );

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/announcements", { title: form.title, body: form.body });
      setForm({ title: "", body: "" });
      setOpen(false);
      ann.reload();
      notify("Объявление опубликовано");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await del(`/announcements/${id}`);
      ann.reload();
      notify("Удалено");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.03em" }}>Новости</h1>
        {isAdmin && (
          <button type="button" className="btn sm primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={15} /> Объявление
          </button>
        )}
      </div>

      {(ann.loading && !ann.data) ? (
        <Spinner text="Загружаем" />
      ) : ann.error ? (
        <ErrorBox message={ann.error} onRetry={ann.reload} />
      ) : !ann.data?.length ? (
        <Empty icon="bell" title="Объявлений пока нет" text="Староста сможет написать здесь о переносах и дедлайнах." />
      ) : (
        <div className="card">
          {ann.data.map((a) => (
            <div key={a.id} className={`announce${a.pinned ? " pinned" : ""}`}>
              <strong>{a.pinned ? "📌 " : ""}{a.title}</strong>
              {a.body && <p>{a.body}</p>}
              <div className="meta">
                <Avatar name={a.author_name} color={a.author_color} size={18} />
                {a.author_name} · {new Date(a.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                {isAdmin && (
                  <button type="button" className="link" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => remove(a.id)}>
                    удалить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-head"><h2>Дедлайны</h2></div>
        {dl.loading && !dl.data ? (
          <Spinner text="Загружаем" />
        ) : !dl.data?.length ? (
          <Empty icon="book" title="Дедлайнов нет" text="Когда появятся — покажем здесь с датой сдачи." />
        ) : (
          dl.data.map((d) => <DeadlineRow key={d.id} item={d} />)
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Новое объявление">
        <form onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label htmlFor="t">Заголовок</label>
            <input id="t" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Перенос пары" required />
          </div>
          <div className="field">
            <label htmlFor="b">Текст</label>
            <textarea id="b" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Что случилось и что делать" />
          </div>
          <button type="submit" className="btn primary block" disabled={busy}>
            {busy ? "Публикуем…" : "Опубликовать"}
          </button>
        </form>
      </Sheet>
    </>
  );
}

function DeadlineRow({ item }) {
  const d = parseIso(item.due_date);
  const days = Math.ceil((d - new Date()) / 86400000);
  const soon = days >= 0 && days <= 3;

  return (
    <div className={`deadline${soon ? " soon" : ""}`}>
      <div className="date">
        <b>{dayNumber(item.due_date)}</b>
        <span>{monthShort(item.due_date)}</span>
      </div>
      <div className="info">
        <strong>{item.title}</strong>
        <span>
          {item.subject ? `${item.subject} · ` : ""}
          {days < 0 ? "просрочено" : days === 0 ? "сегодня" : `через ${days} дн.`}
        </span>
      </div>
      {item.color && <span style={{ width: 8, height: 8, borderRadius: 99, background: item.color }} />}
    </div>
  );
}
