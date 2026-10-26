import { useEffect, useState } from "react";
import { get, post, del, subscribe, isStaff } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox, Empty, Sheet, Avatar } from "../ui.jsx";
import { dayNumber, monthShort, parseIso, todayIso, remainingMs, formatRemaining } from "../dates.js";

/* ─────────────── живой таймер ─────────────── */

function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export default function News({ me, notify }) {
  const ann = useFetch(() => get("/announcements"), []);
  const deadlines = useFetch(() => get("/deadlines"), []);
  const homework = useFetch(() => get("/homework"), []);
  const subjects = useFetch(() => get("/subjects"), []);
  const polls = useFetch(() => get("/polls"), []);
  const now = useNow(1000);

  const [pollOpen, setPollOpen] = useState(false);
  const [pollForm, setPollForm] = useState({ question: "", options: ["", "", ""], multiple: false });
  const [pollBusy, setPollBusy] = useState(false);

  const [hwOpen, setHwOpen] = useState(false);
  const [hwForm, setHwForm] = useState({ title: "", description: "", subjectId: "", dueDate: "" });
  const [hwBusy, setHwBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [dlOpen, setDlOpen] = useState(false);
  const [dlForm, setDlForm] = useState({ title: "", dueDate: todayIso(), subjectId: "" });
  const [dlBusy, setDlBusy] = useState(false);

  const isAdmin = isStaff(me);

  useEffect(() => subscribe({ announcement: () => ann.reload() }), []);

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

  async function removeAnnouncement(id) {
    try {
      await del(`/announcements/${id}`);
      ann.reload();
      notify("Удалено");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function createDeadline(e) {
    e.preventDefault();
    setDlBusy(true);
    try {
      await post("/deadlines", {
        title: dlForm.title,
        dueDate: dlForm.dueDate,
        subjectId: dlForm.subjectId || null,
      });
      setDlForm({ title: "", dueDate: todayIso(), subjectId: "" });
      setDlOpen(false);
      deadlines.reload();
      notify("Дедлайн добавлен");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setDlBusy(false);
    }
  }

  async function removeDeadline(id) {
    try {
      await del(`/deadlines/${id}`);
      deadlines.reload();
      notify("Дедлайн удалён");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function createPoll(e) {
    e.preventDefault();
    setPollBusy(true);
    try {
      await post("/polls", {
        question: pollForm.question,
        options: pollForm.options.filter((o) => o.trim()),
        multiple: pollForm.multiple,
      });
      setPollForm({ question: "", options: ["", "", ""], multiple: false });
      setPollOpen(false);
      polls.reload();
      notify("Опрос создан");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setPollBusy(false);
    }
  }

  async function vote(id, option) {
    try {
      await post(`/polls/${id}/vote`, { option });
      polls.reload();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function removePoll(id) {
    try {
      await del(`/polls/${id}`);
      polls.reload();
      notify("Опрос удалён");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function createHomework(e) {
    e.preventDefault();
    setHwBusy(true);
    try {
      await post("/homework", {
        title: hwForm.title,
        description: hwForm.description,
        subjectId: hwForm.subjectId || null,
        dueDate: hwForm.dueDate || null,
      });
      setHwForm({ title: "", description: "", subjectId: "", dueDate: "" });
      setHwOpen(false);
      homework.reload();
      notify("Домашка добавлена");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setHwBusy(false);
    }
  }

  async function removeHomework(id) {
    try {
      await del(`/homework/${id}`);
      homework.reload();
      notify("Задание удалено");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function toggleHomework(id) {
    try {
      const r = await post(`/homework/${id}/toggle`, {});
      homework.reload();
      notify(r.mine ? "Отмечено как сделано" : "Снята отметка");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  const sorted = [...(deadlines.data ?? [])].sort(
    (a, b) => parseIso(a.due_date) - parseIso(b.due_date)
  );
  const upcoming = sorted.filter((d) => remainingMs(d.due_date, now) > 0);
  const overdue = sorted.filter((d) => remainingMs(d.due_date, now) <= 0);

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

      {ann.loading && !ann.data ? (
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
                {a.author_name} ·{" "}
                {new Date(a.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                {isAdmin && (
                  <button type="button" className="link" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => removeAnnouncement(a.id)}>
                    удалить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h2>Опросы</h2>
          <button type="button" className="link" onClick={() => setPollOpen(true)}>
            + опрос
          </button>
        </div>

        {(polls.data ?? []).length === 0 ? (
          <div className="tiny muted" style={{ padding: "2px 2px 6px" }}>
            Спроси группу: «идём на пару?», «кто сдал лабу?»
          </div>
        ) : (
          (polls.data ?? []).map((p) => (
            <div className="card" key={p.id} style={{ marginBottom: 10 }}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <strong style={{ fontSize: 14 }}>{p.question}</strong>
                {(isAdmin || p.author_id === me.user.id) && (
                  <button type="button" className="link" style={{ fontSize: 12 }} onClick={() => removePoll(p.id)}>
                    удалить
                  </button>
                )}
              </div>

              <div className="poll-options">
                {p.options.map((label, i) => {
                  const count = p.counts[i] ?? 0;
                  const pct = p.voters ? Math.round((count / p.voters) * 100) : 0;
                  const chosen = p.myVotes.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`poll-option${chosen ? " on" : ""}`}
                      onClick={() => vote(p.id, i)}
                      aria-pressed={chosen}
                    >
                      <span className="poll-fill" style={{ width: `${pct}%` }} />
                      <span className="poll-label">
                        {chosen ? "✓ " : ""}
                        {label}
                      </span>
                      <span className="poll-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="tiny muted" style={{ marginTop: 6 }}>
                {p.voters} проголосовало
                {p.multiple ? " · можно несколько" : ""}
                {p.author_name ? ` · ${p.author_name}` : ""}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Домашние задания</h2>
          <button type="button" className="link" onClick={() => setHwOpen(true)}>
            + задать
          </button>
        </div>

        {homework.loading && !homework.data ? (
          <Spinner text="Загружаем" />
        ) : homework.error ? (
          <ErrorBox message={homework.error} onRetry={homework.reload} />
        ) : !homework.data?.length ? (
          <Empty icon="book" title="Домашки пока нет" text="Староста может записать, что задали на паре." />
        ) : (
          <div className="card" style={{ padding: "6px 14px" }}>
            {homework.data.map((h) => (
              <div key={h.id} className={`hw${h.mine ? " done" : ""}`}>
                <button
                  type="button"
                  className={`hw-check${h.mine ? " on" : ""}`}
                  onClick={() => toggleHomework(h.id)}
                  aria-pressed={h.mine}
                  aria-label="Сделано"
                >
                  {h.mine && <Icon name="check" size={14} />}
                </button>

                <div className="hw-body">
                  <strong>{h.title}</strong>
                  {h.description && <p>{h.description}</p>}
                  <div className="hw-meta">
                    {h.status === "pending" && <span style={{ color: "var(--warn)" }}>на проверке</span>}
                    {h.subject && <span style={{ color: h.color }}>{h.subject}</span>}
                    <span>{h.assigned_on ? `задано ${dayNumber(h.assigned_on)} ${monthShort(h.assigned_on)}` : "без даты"}</span>
                    <span>{h.due_date ? `сдать ${dayNumber(h.due_date)} ${monthShort(h.due_date)}` : "без срока"}</span>
                    <span>сделали {h.done_count} из {h.total}</span>
                  </div>
                </div>

                {(isAdmin || h.author_id === me.user.id) && (
                  <button type="button" className="icon-btn" onClick={() => removeHomework(h.id)} aria-label="Удалить задание">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Дедлайны</h2>
          {isAdmin && (
            <button type="button" className="link" onClick={() => setDlOpen(true)}>
              + добавить
            </button>
          )}
        </div>

        {deadlines.loading && !deadlines.data ? (
          <Spinner text="Загружаем" />
        ) : deadlines.error ? (
          <ErrorBox message={deadlines.error} onRetry={deadlines.reload} />
        ) : !sorted.length ? (
          <Empty icon="book" title="Дедлайнов нет" text="Добавь первый — покажем обратный отсчёт." />
        ) : (
          <>
            {upcoming.map((d) => (
              <DeadlineRow key={d.id} item={d} now={now} isAdmin={isAdmin} onDelete={removeDeadline} />
            ))}
            {overdue.length > 0 && (
              <div className="tiny muted" style={{ margin: "12px 0 6px" }}>просроченные</div>
            )}
            {overdue.map((d) => (
              <DeadlineRow key={d.id} item={d} now={now} isAdmin={isAdmin} onDelete={removeDeadline} />
            ))}
          </>
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

      <Sheet open={dlOpen} onClose={() => setDlOpen(false)} title="Новый дедлайн">
        <form onSubmit={createDeadline}>
          <div className="field">
            <label htmlFor="dlt">Что сдать</label>
            <input
              id="dlt"
              value={dlForm.title}
              onChange={(e) => setDlForm({ ...dlForm, title: e.target.value })}
              placeholder="Лабораторная №3"
              maxLength={120}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="dld">Срок</label>
            <input
              id="dld"
              type="date"
              value={dlForm.dueDate}
              onChange={(e) => setDlForm({ ...dlForm, dueDate: e.target.value })}
              required
            />
            <span className="hint">Отсчёт идёт до конца этого дня</span>
          </div>
          <div className="field">
            <label htmlFor="dls">Предмет</label>
            <select id="dls" value={dlForm.subjectId} onChange={(e) => setDlForm({ ...dlForm, subjectId: e.target.value })}>
              <option value="">без предмета</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn primary block" disabled={dlBusy}>
            {dlBusy ? "Сохраняем…" : "Добавить"}
          </button>
        </form>
      </Sheet>
      <Sheet open={pollOpen} onClose={() => setPollOpen(false)} title="Новый опрос">
        <form onSubmit={createPoll}>
          <div className="field">
            <label htmlFor="pq">Вопрос</label>
            <input
              id="pq"
              value={pollForm.question}
              onChange={(e) => setPollForm({ ...pollForm, question: e.target.value })}
              placeholder="Идём на консультацию в четверг?"
              maxLength={160}
              required
            />
          </div>

          {pollForm.options.map((opt, i) => (
            <div className="field" key={i}>
              <label htmlFor={`po${i}`}>Вариант {i + 1}</label>
              <input
                id={`po${i}`}
                value={opt}
                onChange={(e) => {
                  const next = [...pollForm.options];
                  next[i] = e.target.value;
                  setPollForm({ ...pollForm, options: next });
                }}
                placeholder={i === 0 ? "Да" : i === 1 ? "Нет" : "Необязательно"}
              />
            </div>
          ))}

          <label className="row" style={{ gap: 8, marginBottom: 14, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={pollForm.multiple}
              onChange={(e) => setPollForm({ ...pollForm, multiple: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            Можно выбрать несколько вариантов
          </label>

          <button type="submit" className="btn primary block" disabled={pollBusy}>
            {pollBusy ? "Создаём…" : "Создать опрос"}
          </button>
        </form>
      </Sheet>

      <Sheet open={hwOpen} onClose={() => setHwOpen(false)} title="Новое задание">
        <form onSubmit={createHomework}>
          <div className="field">
            <label htmlFor="hwt">Что задали</label>
            <input
              id="hwt"
              value={hwForm.title}
              onChange={(e) => setHwForm({ ...hwForm, title: e.target.value })}
              placeholder="Параграф 12, задачи 3–7"
              maxLength={160}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="hwd">Подробности</label>
            <textarea
              id="hwd"
              value={hwForm.description}
              onChange={(e) => setHwForm({ ...hwForm, description: e.target.value })}
              placeholder="Что именно делать, на что обратить внимание"
            />
          </div>
          <div className="field">
            <label htmlFor="hws">Предмет</label>
            <select
              id="hws"
              value={hwForm.subjectId}
              onChange={(e) => setHwForm({ ...hwForm, subjectId: e.target.value })}
            >
              <option value="">без предмета</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hwdd">Сдать до (необязательно)</label>
            <input
              id="hwdd"
              type="date"
              value={hwForm.dueDate}
              onChange={(e) => setHwForm({ ...hwForm, dueDate: e.target.value })}
            />
          </div>
          <button type="submit" className="btn primary block" disabled={hwBusy}>
            {hwBusy ? "Сохраняем…" : "Задать"}
          </button>
        </form>
      </Sheet>
    </>
  );
}

function DeadlineRow({ item, now, isAdmin, onDelete }) {
  const ms = remainingMs(item.due_date, now);
  const late = ms <= 0;
  const soon = !late && ms < 3 * 86400000;

  const countdown = late
    ? "просрочено"
    : ms < 86400000
      ? `осталось ${formatRemaining(ms)}`
      : `через ${formatRemaining(ms)}`;

  return (
    <div className={`deadline${late ? " late" : soon ? " soon" : ""}`}>
      <div className="date">
        <b>{dayNumber(item.due_date)}</b>
        <span>{monthShort(item.due_date)}</span>
      </div>

      <div className="info">
        <strong>{item.title}</strong>
        <span>
          {item.subject ? `${item.subject} · ` : ""}
          <em className={late ? "count late" : soon ? "count soon" : "count"}>{countdown}</em>
        </span>
      </div>

      {isAdmin && (
        <button type="button" className="icon-btn" onClick={() => onDelete(item.id)} aria-label="Удалить дедлайн" title="Удалить">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
