import { get, isStaff } from "../api.js";
import { useFetch, Ring, Bar, Avatar, Spinner, ErrorBox } from "../ui.jsx";
import { STATUS } from "../api.js";
import { plural } from "./Today.jsx";

export default function Stats({ me }) {
  const mine = useFetch(() => get("/stats/me"), []);
  const group = useFetch(() => (isStaff(me) ? get("/stats/group") : Promise.resolve(null)), []);

  if (mine.loading && !mine.data) return <Spinner text="Считаем статистику" />;
  if (mine.error) return <ErrorBox message={mine.error} onRetry={mine.reload} />;

  const { totals, bySubject, streak } = mine.data;
  const g = group.data;

  return (
    <>
      <h1 style={{ margin: "0 0 14px", fontSize: 22, letterSpacing: "-0.03em" }}>Статистика</h1>

      <section className="card">
        <div className="row" style={{ gap: 18 }}>
          <Ring value={totals.rate ?? 0} label={totals.rate == null ? "—" : `${totals.rate}%`} sublabel="посещаемость" />
          <div style={{ flex: 1 }}>
            <div className="metric" style={{ marginBottom: 8 }}>
              <b>{streak}</b>
              <span>{plural(streak, "день", "дня", "дней")} без пропусков</span>
            </div>
            <div className="tiny muted">
              Отмечено {totals.total} {plural(totals.total, "пара", "пары", "пар")} за 120 дней
            </div>
          </div>
        </div>

        <div className="grid-2 mt-lg">
          <div className="metric"><b style={{ color: STATUS.going.color }}>{totals.going}</b><span>был</span></div>
          <div className="metric"><b style={{ color: STATUS.late.color }}>{totals.late}</b><span>опоздал</span></div>
          <div className="metric"><b style={{ color: STATUS.absent.color }}>{totals.absent}</b><span>пропустил</span></div>
          <div className="metric"><b style={{ color: STATUS.sick.color }}>{totals.sick}</b><span>уважительная</span></div>
        </div>
      </section>

      <div className="section">
        <div className="section-head"><h2>По предметам</h2></div>
        <div className="card">
          {bySubject.filter((s) => s.total > 0).length === 0 && <div className="muted tiny">Пока нет отметок — статистика появится после первых пар</div>}
          {bySubject.filter((s) => s.total > 0).map((s) => (
            <div key={s.id} className="stat-row">
              <div className="name">
                <span style={{ width: 8, height: 8, borderRadius: 99, background: s.color, flex: "0 0 auto" }} />
                <span>{s.name}</span>
              </div>
              <span className="num">{s.rate == null ? "—" : `${s.rate}%`}</span>
              <div className="sub">
                <Bar value={s.rate ?? 0} color={s.color} />
                <div className="meta mt" style={{ marginTop: 5 }}>
                  {s.visited} посещено · {s.absent} пропущено
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isStaff(me) && (
        <div className="section">
          <div className="section-head">
            <h2>Группа</h2>
            {g?.atRisk?.length > 0 && <span className="tiny" style={{ color: "var(--bad)" }}>{g.atRisk.length} в зоне риска</span>}
          </div>

          {group.loading && !g ? (
            <Spinner text="Считаем группу" />
          ) : (
            <div className="card">
              {(g?.students ?? []).map((s) => (
                <div key={s.id} className="stat-row">
                  <div className="name">
                    <Avatar name={s.name} color={s.color} size={26} />
                    <span>{s.name}</span>
                  </div>
                  <span className="num" style={{ color: rateColor(s.rate) }}>{s.rate == null ? "—" : `${s.rate}%`}</span>
                  <div className="sub">
                    <Bar value={s.rate ?? 0} />
                    <div className="meta" style={{ marginTop: 5 }}>
                      был {s.going} · опоздал {s.late} · пропустил {s.absent} · уваж. {s.sick}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {g?.bySubject?.length > 0 && (
            <div className="grid-2 mt-lg">
              {g.bySubject.map((s) => (
                <div key={s.id} className="metric">
                  <b style={{ color: s.color }}>{s.rate == null ? "—" : `${s.rate}%`}</b>
                  <span>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const rateColor = (r) => (r == null ? "var(--muted)" : r >= 85 ? "var(--ok)" : r >= 60 ? "var(--warn)" : "var(--bad)");
