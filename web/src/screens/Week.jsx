import { useState } from "react";
import { get, post } from "../api.js";
import { useFetch, Icon, Spinner, ErrorBox, Empty, Sheet } from "../ui.jsx";
import LessonCard from "../LessonCard.jsx";
import StatusOptions from "../StatusOptions.jsx";
import { go } from "../router.js";
import { addDays, todayIso, dayNumber, monthShort, WEEKDAYS_SHORT } from "../dates.js";
import { plural } from "./Today.jsx";

export default function Week({ notify }) {
  const [anchor, setAnchor] = useState(() => todayIso());
  const [selected, setSelected] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get(`/schedule?week=${anchor}`), [anchor]);

  const days = data?.week ?? [];
  const today = todayIso();
  const active = days.find((d) => d.date === selected) ?? days.find((d) => d.date === today) ?? days[0];

  const total = days.reduce((sum, d) => sum + d.lessons.length, 0);

  async function markAll(status) {
    try {
      const r = await post("/attendance/day", { date: active.date, status });
      setBulkOpen(false);
      notify?.(`Отмечено пар: ${r.count}`);
      reload();
    } catch (err) {
      notify?.(err.message, "err");
    }
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="tiny muted">неделя</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, letterSpacing: "-0.03em" }}>
            {total ? `${total} ${plural(total, "пара", "пары", "пар")}` : "пусто"}
          </h1>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="icon-btn" onClick={() => { setSelected(null); setAnchor(addDays(anchor, -7)); }} aria-label="Прошлая неделя">
            <Icon name="left" size={17} />
          </button>
          <button type="button" className="btn sm ghost" onClick={() => { setSelected(null); setAnchor(today); }}>
            сегодня
          </button>
          <button type="button" className="icon-btn" onClick={() => { setSelected(null); setAnchor(addDays(anchor, 7)); }} aria-label="Следующая неделя">
            <Icon name="right" size={17} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Spinner text="Загружаем неделю" />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : (
        <>
          <div className="weekbar">
            {days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                className={`day-chip${active?.date === d.date ? " on" : ""}${d.date === today ? " today" : ""}`}
                onClick={() => setSelected(d.date)}
              >
                <span>{WEEKDAYS_SHORT[i]}</span>
                <b>{dayNumber(d.date)}</b>
                <span className="tiny muted" style={{ fontSize: 9 }}>{d.lessons.length || "—"}</span>
              </button>
            ))}
          </div>

          {active && (
            <div className="row between" style={{ margin: "6px 0 10px" }}>
              <strong style={{ fontSize: 14 }}>
                {WEEKDAYS_SHORT[(active.weekday ?? 1) - 1]}, {dayNumber(active.date)} {monthShort(active.date)}
              </strong>
              <div className="row" style={{ gap: 12 }}>
                {active.lessons.length > 0 && (
                  <button type="button" className="link" onClick={() => setBulkOpen(true)}>
                    отметить всё
                  </button>
                )}
                <span className="tiny muted">
                  {active.lessons.length || "нет"} {plural(active.lessons.length, "пара", "пары", "пар")}
                </span>
              </div>
            </div>
          )}

          {!active?.lessons.length ? (
            <Empty icon="spark" title="В этот день пар нет" text="Выбери другой день или пролистай неделю." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {active.lessons.map((l) => (
                <LessonCard key={`${l.slotId}-${l.date}`} lesson={l} showParity onOpen={() => go(`/lesson/${l.slotId}?date=${l.date}`)} />
              ))}
            </div>
          )}
        </>
      )}
      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="Отметить все пары">
        {active && (
          <>
            <p className="tiny muted" style={{ marginTop: 0 }}>
              Применится к {active.lessons.length} {plural(active.lessons.length, "паре", "парам", "парам")} —
              {" "}{dayNumber(active.date)} {monthShort(active.date)}.
            </p>
            <StatusOptions value={null} onChange={markAll} />
          </>
        )}
      </Sheet>
    </>
  );
}
