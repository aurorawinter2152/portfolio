// 收益日历：月视图（按日收益）/ 年视图（按月收益）
// dailyMap: Map<"YYYY-MM-DD", cents>

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function yuan(cents) {
  return (Math.abs(cents) / 100).toFixed(2);
}
function cellVal(v) {
  if (v === null || v === undefined || v === 0) return { text: "0.00", cls: "flat" };
  return { text: (v < 0 ? "-" : "") + yuan(v), cls: v > 0 ? "pos" : "neg" };
}
function signedMoney(cents) {
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  return sign + "¥" + yuan(cents);
}

export function calendarHtml({ dailyMap, mode = "month", ref, today, selected = null, monthXirr = null }) {
  const y = Number(ref.slice(0, 4));
  const m = Number(ref.slice(5, 7));
  if (mode === "year") return yearView(dailyMap, y, today, selected, monthXirr);
  return monthView(dailyMap, y, m, today, selected);
}

function head(y, label, mode) {
  return `<div class="cal-head">
    <button class="cal-nav" data-action="cal-prev">‹</button>
    <div class="cal-title">${label}</div>
    <button class="cal-nav" data-action="cal-next">›</button>
    <div class="cal-seg">
      <button class="${mode === "month" ? "on" : ""}" data-action="cal-mode" data-mode="month">月</button>
      <button class="${mode === "year" ? "on" : ""}" data-action="cal-mode" data-mode="year">年</button>
    </div>
  </div>`;
}

function monthView(map, y, m, today, selected) {
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=周日
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ day: prevDays - startWeekday + 1 + i, out: true });
  }
  let monthTotal = 0;
  for (let d = 1; d <= days; d++) {
    const date = ymd(y, m, d);
    const val = map.has(date) ? map.get(date) : null;
    if (val != null) monthTotal += val;
    cells.push({ day: d, out: false, date, val, today: date === today });
  }
  let nd = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nd++, out: true });

  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const body = cells
    .map((c) => {
      if (c.out) return `<div class="cal-cell out"><div class="cal-d">${c.day}</div><div class="cal-v"></div></div>`;
      const { text, cls } = cellVal(c.val);
      const bg = c.val > 0 ? "bg-pos" : c.val < 0 ? "bg-neg" : "";
      return `<div class="cal-cell ${c.today ? "today" : ""} ${bg} ${selected === c.date ? "sel" : ""}" data-action="cal-select" data-date="${c.date}">
        <div class="cal-d">${c.day}</div>
        <div class="cal-v ${cls}">${text}</div>
      </div>`;
    })
    .join("");

  return `<div class="cal">
    ${head(y, `${y}年${m}月`, "month")}
    <div class="cal-total">本月收益 <b class="${monthTotal > 0 ? "pos" : monthTotal < 0 ? "neg" : "flat"}">${signedMoney(monthTotal)}</b></div>
    <div class="cal-week">${weekdays.map((w) => `<div class="cal-wd">${w}</div>`).join("")}</div>
    <div class="cal-grid">${body}</div>
  </div>`;
}

function yearView(map, y, today, selected, monthXirr) {
  let yearTotal = 0;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = `${y}-${String(m).padStart(2, "0")}`;
    let sum = 0;
    for (const [date, val] of map) if (date.startsWith(prefix)) sum += val;
    yearTotal += sum;
    months.push({ m, sum, prefix });
  }
  const cells = months
    .map(({ m, sum, prefix }) => {
      const c = sum > 0 ? "pos" : sum < 0 ? "neg" : "flat";
      const xi = monthXirr ? monthXirr.get(prefix) : null;
      const xOk = xi && xi.ok;
      const xText = xOk ? `${xi.value >= 0 ? "" : "-"}${(Math.abs(xi.value) * 100).toFixed(2)}%` : "—";
      const xCls = xOk ? (xi.value > 0 ? "pos" : xi.value < 0 ? "neg" : "flat") : "flat";
      const isPast = prefix <= today.slice(0, 7);
      return `<div class="cal-mcell ${selected && String(selected).startsWith(prefix) ? "sel" : ""} ${isPast ? "past" : ""}" data-action="cal-select-month" data-month="${prefix}">
        <div class="cal-md">${m}月</div>
        <div class="cal-mv ${c}">${sum === 0 ? "0.00" : (sum < 0 ? "-" : "") + yuan(sum)}</div>
        <div class="cal-mxr ${xCls}">年化 ${xText}</div>
      </div>`;
    })
    .join("");

  return `<div class="cal">
    ${head(y, `${y}年`, "year")}
    <div class="cal-total">全年收益 <b class="${yearTotal > 0 ? "pos" : yearTotal < 0 ? "neg" : "flat"}">${signedMoney(yearTotal)}</b></div>
    <div class="cal-mgrid">${cells}</div>
  </div>`;
}
