// 极简 SVG 曲线（无依赖），支持点击某日查看数值
export function lineChart(points, { width = 360, height = 176, id = "c", color = "auto", selected = null, scope = "" } = {}) {
  if (!points || points.length === 0) return `<div class="chart-empty">暂无收益曲线数据</div>`;

  const pad = { l: 8, r: 10, t: 18, b: 22 };
  const w = width;
  const h = height;
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals, 0);
  let max = Math.max(...vals, 0);
  if (min === max) {
    min -= 100;
    max += 100;
  }
  const range = max - min;
  min -= range * 0.1;
  max += range * 0.1;

  const n = points.length;
  const X = (i) => pad.l + (n === 1 ? (w - pad.l - pad.r) / 2 : (i / (n - 1)) * (w - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);

  const line = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
  const baseY = Y(0);
  const area = `${line} L${X(n - 1).toFixed(1)},${baseY.toFixed(2)} L${X(0).toFixed(1)},${baseY.toFixed(2)} Z`;

  const last = vals[n - 1];
  const stroke = last >= 0 ? "#e8453c" : "#12a25a";
  const gid = "grad_" + id;
  const RED = "#e8453c";
  const GREEN = "#12a25a";
  const segs = [];
  const seg = (x1, y1, x2, y2, c) =>
    `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  for (let i = 0; i < n - 1; i++) {
    const v1 = points[i].value;
    const v2 = points[i + 1].value;
    const x1 = X(i);
    const y1 = Y(v1);
    const x2 = X(i + 1);
    const y2 = Y(v2);
    if ((v1 >= 0 && v2 >= 0) || (v1 <= 0 && v2 <= 0)) {
      segs.push(seg(x1, y1, x2, y2, v1 >= 0 ? RED : GREEN));
    } else {
      const t = v1 / (v1 - v2);
      const xz = x1 + (x2 - x1) * t;
      const yz = Y(0);
      segs.push(seg(x1, y1, xz, yz, v1 >= 0 ? RED : GREEN));
      segs.push(seg(xz, yz, x2, y2, v2 >= 0 ? RED : GREEN));
    }
  }

  const zeroLine =
    min < 0 && max > 0
      ? `<line x1="${pad.l}" y1="${baseY.toFixed(1)}" x2="${w - pad.r}" y2="${baseY.toFixed(1)}" stroke="#d7dae0" stroke-dasharray="3 4" stroke-width="1"/>`
      : "";

  const firstDate = points[0].date.slice(5).replace("-", "/");
  const lastDate = points[n - 1].date.slice(5).replace("-", "/");

  const selIdx = selected ? points.findIndex((p) => p.date === selected) : -1;
  const marker =
    selIdx >= 0
      ? `<line x1="${X(selIdx).toFixed(1)}" y1="${pad.t}" x2="${X(selIdx).toFixed(1)}" y2="${(h - pad.b).toFixed(1)}" stroke="#2b6df6" stroke-dasharray="3 3" stroke-width="1"/>
         <circle cx="${X(selIdx).toFixed(1)}" cy="${Y(points[selIdx].value).toFixed(1)}" r="4" fill="#2b6df6" stroke="#fff" stroke-width="1.5"/>`
      : "";

  const step = n > 1 ? (w - pad.l - pad.r) / (n - 1) : w - pad.l - pad.r;
  const hitW = Math.max(8, step);
  const hits = points
    .map((p, i) => {
      const x = Math.max(0, X(i) - hitW / 2);
      return `<rect x="${x.toFixed(1)}" y="0" width="${hitW.toFixed(1)}" height="${h}" fill="rgba(0,0,0,0)" pointer-events="all" data-action="chart-pick" data-date="${p.date}" data-scope="${scope || id}"></rect>`;
    })
    .join("");

  return `
  <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="单日万收曲线">
    ${zeroLine}
    ${segs.join("")}
    <circle cx="${X(n - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="3" fill="${stroke}"/>
    ${marker}
    <text x="${pad.l}" y="${h - 6}" font-size="10.5" fill="#9aa0a8">${firstDate}</text>
    <text x="${w - pad.r}" y="${h - 6}" font-size="10.5" fill="#9aa0a8" text-anchor="end">${lastDate}</text>
    ${hits}
  </svg>`;
}
