import { useEffect, useState } from "react";
import { get, post, subscribe, STATUS } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox, Empty, Sheet } from "../ui.jsx";
import LessonCard from "../LessonCard.jsx";
import StatusOptions from "../StatusOptions.jsx";
import { go } from "../router.js";
import { remainingMs, formatRemaining } from "../dates.js";

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function minutesUntil(time) {
  const [h, m] = time.split(":").map(Number);
  const now = new Date();
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
}

function humanUntil(diff) {
  if (diff < 0) return "";
  if (diff < 60) return `через ${diff} мин`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `через ${h} ч${m ? ` ${m} мин` : ""}`;
}

export default function Today({ notify }) {
  const { data, loading, error, reload } = useFetch(() => get("/today"), []);
  const deadlines = useFetch(() => get("/deadlines"), []);
  const [now, setNow] = useState(() => Date.now());
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return subscribe({
      attendance: () => reload(),
      roster: () => reload(),
    });
  }, []);

  async function mark(lesson, status) {
    try {
      await post("/attendance", { slotId: lesson.slotId, date: lesson.date, status });
      notify(`Отмечено: ${STATUS[status].label}`);
      reload();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function markAll(status) {
    try {
      const r = await post("/attendance/day", { date: data.today.date, status });
      setBulkOpen(false);
      notify(`Отмечено пар: ${r.count}`);
      reload();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  if (loading && !data) return <Spinner text="Загружаем день" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { today } = data;
  const lessons = today.lessons;
  const current = lessons.find((l) => l.status === "now");
  const next = lessons.find((l) => l.status === "upcoming");
  const hero = current ?? next;

  const nearest = (deadlines.data ?? [])
    .map((d) => ({ ...d, ms: remainingMs(d.due_date, now) }))
    .filter((d) => d.ms > 0)
    .sort((a, b) => a.ms - b.ms)[0];

  const date = new Date();
  const weekday = WEEKDAYS[date.getDay()];
  const dateLabel = `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${today.label}`;

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div className="tiny muted">{dateLabel}</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, letterSpacing: "-0.03em" }}>
            {lessons.length ? `${lessons.length} ${plural(lessons.length, "пара", "пары", "пар")}` : "Пар нет"}
          </h1>
        </div>
      </div>

      {hero && (
        <section className="hero" style={{ "--subj-color": hero.subject.color }}>
          <div className="hero-top">
            <span className="hero-badge">{current ? "сейчас идёт" : "следующая пара"}</span>
            {!current && <span className="tiny muted">{humanUntil(minutesUntil(hero.start))}</span>}
          </div>

          <h2>{hero.subject.name}</h2>

          <div className="hero-time">
            <Icon name="clock" size={15} />
            {hero.start}–{hero.end} · {hero.pair} пара
          </div>
          <div className="hero-meta">
            {hero.room && (
              <span>
                <Icon name="door" size={14} /> ауд. {hero.room}
              </span>
            )}
            {hero.teacher && (
              <span>
                <Icon name="user" size={14} /> {hero.teacher}
              </span>
            )}
          </div>

          <StatusOptions value={hero.myStatus} onChange={(status) => mark(hero, status)} />

          <button type="button" className="link mt" onClick={() => go(`/lesson/${hero.slotId}`)}>
            Кто идёт →
          </button>
        </section>
      )}

      {!hero && lessons.length > 0 && (
        <section className="card">
          <div className="row between">
            <strong>Пары на сегодня закончились</strong>
            <span className="status-pill going">
              {lessons.filter((l) => l.myStatus === "going" || l.myStatus === "late").length} из {lessons.length}
            </span>
          </div>
          <p className="tiny muted" style={{ margin: "6px 0 10px" }}>
            Твои отметки за день. Если что-то не так — открой пару и поправь.
          </p>
          <div className="grid-2">
            {lessons.map((l) => (
              <button
                key={l.slotId}
                type="button"
                className={`option${l.myStatus ? ` on ${l.myStatus}` : ""}`}
                onClick={() => go(`/lesson/${l.slotId}`)}
              >
                <span className="emoji">{l.pair}</span>
                {l.myStatus ? STATUS[l.myStatus].short : "нет отметки"}
              </button>
            ))}
          </div>
        </section>
      )}

      {nearest && (
        <button type="button" className={`deadline-banner${nearest.ms < 86400000 ? " soon" : ""}`} onClick={() => go("/news")}>
          <span className="db-icon">
            <Icon name="bell" size={16} />
          </span>
          <span className="db-text">
            <strong>{nearest.title}</strong>
            <span>{formatRemaining(nearest.ms)}</span>
          </span>
          <Icon name="right" size={16} />
        </button>
      )}

      <div className="section">
        <div className="section-head">
          <h2>Расписание дня</h2>
          <div className="row" style={{ gap: 12 }}>
            {lessons.length > 0 && (
              <button type="button" className="link" onClick={() => setBulkOpen(true)}>
                отметить всё
              </button>
            )}
            <button type="button" className="link" onClick={() => go("/week")}>
              вся неделя
            </button>
          </div>
        </div>

        {lessons.length === 0 ? (
          <Empty icon="spark" title="Сегодня пар нет" text="Можно выдохнуть. Расписание на неделю — во вкладке «Неделя»." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {lessons.map((l) => (
              <LessonCard key={l.slotId} lesson={l} onOpen={() => go(`/lesson/${l.slotId}`)} />
            ))}
          </div>
        )}
      </div>
      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="Отметить все пары">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Применится сразу к {lessons.length} {lessons.length === 1 ? "паре" : "парам"} этого дня.
          Отдельные пары потом можно поправить.
        </p>
        <StatusOptions value={null} onChange={markAll} />
      </Sheet>
    </>
  );
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
