// 计算引擎单测：覆盖 PRD 13 验收 7a/7b/7c/7d、8、9、15
import * as F from "../public/js/fixed.js";
import { computeProduct, computeAll, xirrToDate } from "../public/js/engine.js";

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n     期望 ${e}\n     实际 ${a}`); }
}
function assert(cond, label) { eq(!!cond, true, label); }

function buy(id, date, principalCents, nvStr, opts = {}) {
  const nv = F.nvToScaled(nvStr);
  return {
    id, product_code: opts.code || "P1", type: "buy", status: "confirmed",
    trade_date: date, net_value: nvStr,
    shares: opts.pending ? null : F.scaledSharesToStr(F.sharesFromPrincipal(principalCents, nv)),
    gross_amount_cents: principalCents, fee_amount_cents: opts.fee || 0,
    net_amount_cents: principalCents + (opts.fee || 0),
    redeemable_date: opts.redeemableDate || null, note: null, created_at: id
  };
}
function nvRow(date, unit, code = "P1") {
  return { product_code: code, date, unit_net_value: unit, cumulative_net_value: unit };
}
const product = { code: "P1", name: "测试产品", display_name: "测试", status: "active", maturity_date: null };

console.log("== 1. 定点运算 ==");
{
  // 本金 100 元、净值 1.008900 → 份额 ≈ 99.1177
  const sh = F.sharesFromPrincipal(10000, F.nvToScaled("1.008900"));
  const shStr = F.scaledSharesToStr(sh);
  assert(shStr.startsWith("99.11"), `份额≈99.11（实际 ${shStr}）`);
  // 份额 × 净值 回算 ≈ 100 元（允许 1 分误差）
  const back = F.amountCentsFromShares(sh, F.nvToScaled("1.008900"));
  assert(Math.abs(back - 10000) <= 1, `份额×净值回算≈10000 分（实际 ${back}）`);
  eq(F.yuanToCents("1234.56"), 123456, "元→分 1234.56");
  eq(F.centsToYuan(123456), "1234.56", "分→元 123456");
}

console.log("== 2. 当日收益 7a 正常涨跌 ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000")];
  const nvs = [nvRow("2026-10-27", "1.000000"), nvRow("2026-10-28", "1.000000"), nvRow("2026-10-29", "1.050000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.daily.state, "normal", "state=normal");
  eq(p.daily.amountCents, 500, "当日收益 = 100份×(1.05-1.00)=5元=500分");
}

console.log("== 3. 当日收益 7b 真实零涨跌（连续同值 1.008900） ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.008900")];
  const nvs = [nvRow("2026-10-28", "1.008900"), nvRow("2026-10-29", "1.008900")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.daily.state, "zero", "state=zero（不得判为无更新）");
  eq(p.daily.amountCents, 0, "当日收益 = 0 分");
}

console.log("== 4. 当日收益 7c 净值未更新 ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000")];
  const nvs = [nvRow("2026-10-28", "1.000000"), nvRow("2026-10-29", "1.008900")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-31");
  eq(p.daily.state, "stale", "state=stale");
  eq(p.daily.amountCents, null, "不显示金额");
  eq(p.daily.daysAgo, 2, "净值更新至 2 天前");
}

console.log("== 5. 当日收益 7d 当天买入不计入当日收益 ==");
{
  // 昨天持有 100 份；今天又买一笔，净值从 1.00→1.01
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000"), buy("b2", "2026-10-29", 10000, "1.010000")];
  const nvs = [nvRow("2026-10-27", "1.000000"), nvRow("2026-10-28", "1.010000"), nvRow("2026-10-29", "1.010000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  // 基准份额应为昨日 100 份 → (1.01-1.01)=0 涨幅，实际为 0；构造更明显的：从 1.00→1.02
  const nvs2 = [nvRow("2026-10-27", "1.000000"), nvRow("2026-10-28", "1.000000"), nvRow("2026-10-29", "1.020000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p2 = computeProduct(product, txs, nvs2, "2026-10-29");
  // 用昨日 100 份 × 0.02 = 2 元 = 200 分；若误用当前 ~199 份则 ≈ 398 分
  eq(p2.daily.amountCents, 200, "当日收益按昨日份额=200分（非当前份额）");
}

console.log("== 6. 持有份额 / 总收益 ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000")];
  const nvs = [nvRow("2026-10-29", "1.100000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  // 100 份 × 1.10 = 110 元 = 11000 分；总投入 10000；收益 1000 分
  eq(p.marketValueCents, 11000, "市值 110.00");
  eq(p.investedCents, 10000, "总投入 100.00");
  eq(p.profitCents, 1000, "总收益 10.00");
}

console.log("== 7. 待确认交易不计入持仓/收益 ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000"), { ...buy("b2", "2026-10-29", 10000, "1.000000"), status: "pending", net_value: null, shares: null }];
  const nvs = [nvRow("2026-10-29", "1.000000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.pendingCount, 1, "1 笔待确认");
  eq(p.investedCents, 10000, "仅确认的 100 元计入投入");
  eq(p.sharesStr.startsWith("100.0"), true, "份额仅 100");
}

console.log("== 8. 完整曲线（无断点、逐日重算） ==");
{
  const txs = [buy("b1", "2026-10-27", 10000, "1.000000")];
  const nvs = ["2026-10-27", "2026-10-28", "2026-10-29"].map((d, i) => { const r = nvRow(d, (1 + i * 0.01).toFixed(6)); r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.curve.length, 3, "曲线 3 个点");
  eq(p.curve[p.curve.length - 1].cumProfitCents, 200, "末点累计收益 2.00 元（100×2%）");
}

console.log("== 9. XIRR 保护：持有 <7 天不展示 ==");
{
  const txs = [buy("b1", "2026-10-28", 10000, "1.000000")];
  const nvs = [nvRow("2026-10-29", "1.01")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.xirr.ok, false, "不展示");
  eq(p.xirr.reason, "short", "原因=持有时间过短");
}

console.log("== 10. XIRR 正常求解（>7 天，正收益） ==");
{
  const txs = [buy("b1", "2026-01-01", 100000, "1.000000")];
  const nvs = [nvRow("2026-01-01", "1.000000"), nvRow("2026-07-01", "1.050000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-07-01");
  assert(p.xirr.ok, "XIRR 求解成功");
  // 半年 5% → 年化 ≈ 10.2%
  assert(p.xirr.value > 0.09 && p.xirr.value < 0.12, `年化≈10%（实际 ${(p.xirr.value * 100).toFixed(2)}%）`);
}

console.log("== 11. FIFO 与最近可赎回 ==");
{
  const txs = [
    buy("b1", "2026-10-01", 10000, "1.000000", { redeemableDate: "2026-10-15" }),
    buy("b2", "2026-10-20", 10000, "1.000000", { redeemableDate: "2026-11-05" })
  ];
  const nvs = [nvRow("2026-10-29", "1.000000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  // 两批都未赎回，最早可赎回 10-15 已过期 → available
  eq(p.redeemable.state, "available", "最早批次已过可赎回日 → 可随时赎回");
}

console.log("== 12. 浮点无误差（多笔小数累加） ==");
{
  const txs = [];
  for (let i = 0; i < 10; i++) txs.push(buy("b" + i, "2026-10-0" + (i % 9 + 1), 1, "1.000000"));
  const nvs = [nvRow("2026-10-29", "1.000000")].map(r => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-29");
  eq(p.investedCents, 10, "10 笔 × 1 分 = 10 分（整数精确）");
  eq(p.sharesStr, "0.10000000", "10 笔 × 0.01 份 = 0.1 份（定点精确，无浮点误差）");
}

console.log("== 13. 汇总 computeAll ==");
{
  const data = {
    products: [{ ...product }, { ...product, code: "P2", display_name: "产品2" }],
    transactions: [
      buy("b1", "2026-10-27", 10000, "1.000000", { code: "P1" }),
      buy("b2", "2026-10-27", 20000, "1.000000", { code: "P2" })
    ],
    netValues: [
      nvRow("2026-10-29", "1.050000", "P1"),
      nvRow("2026-10-29", "1.000000", "P2")
    ]
  };
  const { aggregate } = computeAll(data, "2026-10-29");
  eq(aggregate.investedCents, 30000, "总投入 300 元");
  eq(aggregate.marketValueCents, 10500 + 20000, "总市值 305 元");
  eq(aggregate.profitCents, 500, "总收益 5 元");
}

console.log("== 14. 持仓从确认份额时间开始 ==");
{
  const txs = [{ ...buy("b1", "2026-10-01", 10000, "1.000000"), nav_date: "2026-10-01", confirm_date: "2026-10-05" }];
  const nvs = ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-06"].map((d) => {
    const r = nvRow(d, d === "2026-10-06" ? "1.100000" : "1.000000");
    r._unitScaled = F.nvToScaled(r.unit_net_value);
    return r;
  });
  const p = computeProduct(product, txs, nvs, "2026-10-06");
  eq(p.curve[0].date, "2026-10-05", "曲线从确认份额日 10-05 开始");
  eq(p.curve[0].sharesStr.startsWith("100.0"), true, "确认日当天持有 100 份");
  eq(p.marketValueCents, 11000, "市值按确认后份额 × 最新净值 = 110.00");
}

console.log("== 15. 未到确认日的买入不计入当前持仓 ==");
{
  const txs = [{ ...buy("b1", "2026-10-06", 10000, "1.000000"), nav_date: "2026-10-06", confirm_date: "2026-10-08" }];
  const nvs = [nvRow("2026-10-06", "1.000000")].map((r) => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-10-06");
  eq(p.marketValueCents, 0, "确认日未到，不计持仓");
  eq(p.investedCents, 0, "确认日未到，不计投入");
}

console.log("== 16. 按截止日算 XIRR ==");
{
  const txs = [buy("b1", "2026-01-01", 100000, "1.000000")];
  const nvs = [nvRow("2026-01-01", "1.000000"), nvRow("2026-07-01", "1.050000")].map((r) => { r._unitScaled = F.nvToScaled(r.unit_net_value); return r; });
  const p = computeProduct(product, txs, nvs, "2026-07-01");
  const xi = xirrToDate(p, "2026-07-01");
  assert(xi.ok, "截止日 XIRR 可求解");
  assert(Math.abs(xi.value - p.xirr.value) < 1e-6, `截止日=最新时 XIRR 一致（${(xi.value * 100).toFixed(2)}%）`);
}

console.log(`\n==== 结果：${pass} 通过，${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
