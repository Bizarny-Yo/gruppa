import { useEffect, useState } from "react";
import { get, post, del, subscribe, STATUS } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox, Avatar } from "../ui.jsx";
import StatusOptions from "../StatusOptions.jsx";
import { go } from "../router.js";
import { todayIso, dayNumber, monthShort, WEEKDAYS_SHORT } from "../dates.js";
import { plural } from "./Today.jsx";

const LABELS = { going: "Идут", late: "Опоздают", absent: "Не идут", sick: "Уважительная" };

export default function Lesson({ me, notify }) {
  const date = new URLSearchParams(location.search).get("date") || todayIso();
  const slotId = Number(location.pathname.split("/").pop());

  const { data, loading, error, reload } = useFetch(
    () => get(`/attendance/${slotId}?date=${date}`),
    [slotId, date]
  );

  useEffect(() => subscribe({ attendance: (e) => e.slotId === slotId && reload(), roster: reload }), [slotId]);

  async function mark(status) {
    try {
      await post("/attendance", { slotId, date, status });
      notify(`Отмечено: ${STATUS[status].label}`);
      reload();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  const [hwTitle, setHwTitle] = useState("");
  const [hwDue, setHwDue] = useState("");
  const [hwBusy, setHwBusy] = useState(false);

  async function addHomework(e) {
    e.preventDefault();
    if (!hwTitle.trim()) return;
    setHwBusy(true);
    try {
      await post("/homework", {
        title: hwTitle,
        subjectId: data.lesson.subjectId,
        slotId,
        assignedOn: date,
        dueDate: hwDue || null,
      });
      setHwTitle("");
      setHwDue("");
      notify("Домашка добавлена");
      reload();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setHwBusy(false);
    }
  }

  async function removeHomework(id) {
    try {
      await del(`/homework/${id}`);
      reload();
      notify("Удалено");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  if (loading && !data) return <Spinner text="Загружаем пару" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { lesson, people, counts } = data;
  const mine = people.find((p) => p.id === me.user.id);
  const marked = people.filter((p) => p.status);
  const unmarked = people.filter((p) => !p.status);
  const coming = counts.going + counts.late;

  const d = new Date(`${date}T12:00:00`);

  return (
    <>
      <button type="button" className="link" onClick={() => history.back()} style={{ marginBottom: 12 }}>
        ← назад
      </button>

      <section className="card" style={{ borderLeft: `4px solid ${lesson.color}` }}>
        <div className="tiny muted">
          {WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}, {dayNumber(date)} {monthShort(date)} · {lesson.pair} пара
        </div>
        <h1 style={{ margin: "4px 0 6px", fontSize: 21, letterSpacing: "-0.03em" }}>{lesson.subject}</h1>
        <div className="lesson-meta">
          <span><Icon name="clock" size={13} /> {lesson.start}–{lesson.end}</span>
          {lesson.room && <span><Icon name="door" size={13} /> ауд. {lesson.room}</span>}
        </div>
      </section>

      <div className="section">
        <div className="section-head">
          <h2>Ваша отметка</h2>
          {date < todayIso() && <span className="tiny muted">прошедшая пара</span>}
        </div>
        <StatusOptions value={mine?.status} onChange={mark} />
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Домашнее задание</h2>
          <span className="tiny muted">{data.homework.length ? `${data.homework.length} шт.` : "нет"}</span>
        </div>

        {data.homework.length > 0 && (
          <div className="card" style={{ padding: "6px 14px", marginBottom: 10 }}>
            {data.homework.map((h) => (
              <div key={h.id} className="hw">
                <div className="hw-body">
                  <strong>{h.title}</strong>
                  {h.description && <p>{h.description}</p>}
                  <div className="hw-meta">
                    <span>{h.author_name ?? "без автора"}</span>
                    <span>{h.due_date ? `сдать ${dayNumber(h.due_date)} ${monthShort(h.due_date)}` : "без срока"}</span>
                  </div>
                </div>
                {(me.user.role === "starosta" || h.author_id === me.user.id) && (
                  <button type="button" className="icon-btn" onClick={() => removeHomework(h.id)} aria-label="Удалить задание">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addHomework} className="hw-form">
          <input
            value={hwTitle}
            onChange={(e) => setHwTitle(e.target.value)}
            placeholder="Что задали на паре?"
            maxLength={160}
          />
          <div className="row" style={{ gap: 8 }}>
            <input
              type="date"
              value={hwDue}
              onChange={(e) => setHwDue(e.target.value)}
              aria-label="Сдать до"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn primary sm" disabled={hwBusy || !hwTitle.trim()}>
              {hwBusy ? "…" : "Добавить"}
            </button>
          </div>
        </form>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Добавить может любой, кто был на паре.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Кто идёт</h2>
          <span className="tiny muted">{coming} из {people.length} · отмечено {marked.length}</span>
        </div>

        <div className="grid-2" style={{ marginBottom: 12 }}>
          {["going", "late", "absent", "sick"].map((k) => (
            <div key={k} className="metric">
              <b style={{ color: STATUS[k].color }}>{counts[k]}</b>
              <span>{LABELS[k]}</span>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: "4px 14px" }}>
          {marked.length === 0 && <div className="empty" style={{ border: 0 }}><strong>Пока никто не отметился</strong><span>Будь первым — группа увидит сразу</span></div>}
          {marked.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </div>

        {unmarked.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h2>Не отметились</h2>
              <span className="tiny muted">{unmarked.length} {plural(unmarked.length, "человек", "человека", "человек")}</span>
            </div>
            <div className="card" style={{ padding: "4px 14px" }}>
              {unmarked.map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function PersonRow({ person }) {
  const st = person.status ? STATUS[person.status] : null;
  return (
    <div className="person">
      <Avatar name={person.name} color={person.color} size={34} />
      <div className="who-name">
        <strong>{person.name}</strong>
        <span>
          {st
            ? person.marked_at
              ? `отметка в ${new Date(person.marked_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : st.label
            : "ещё не отметился"}
        </span>
      </div>
      {st ? <span className={`status-pill ${person.status}`}>{st.emoji} {st.short}</span> : <span className="tiny muted">—</span>}
    </div>
  );
}
