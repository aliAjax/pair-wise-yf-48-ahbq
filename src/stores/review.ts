import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Criterion, ReviewEvent, Scheme, ScoreRecord, Viewer, WeightMap } from "../types";

const KEY = "pair-wise-yf-48/review";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];
const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];
const baseCriteria: Criterion[] = [
  { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
  { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
];
interface PersistedState {
  scores?: ScoreRecord[];
  events?: ReviewEvent[];
  published?: boolean;
  weights?: WeightMap;
  weightVersion?: number;
  lockedWeights?: WeightMap | null;
  schemeStatuses?: Record<string, Scheme["status"]>;
}

function loadState(): PersistedState {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? JSON.parse(saved) as PersistedState : {};
  } catch {
    return {};
  }
}

function normalizeWeights(source: WeightMap | undefined): WeightMap {
  return Object.fromEntries(baseCriteria.map((item) => [item.id, Number(source?.[item.id] ?? item.weight)]));
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

export const useReviewStore = defineStore("review", () => {
  const initial = loadState();
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme })));
  const weights = ref<WeightMap>(normalizeWeights(initial.weights));
  const weightVersion = ref<number>(Number.isInteger(initial.weightVersion) ? initial.weightVersion as number : 0);
  const lockedWeights = ref<WeightMap | null>(initial.lockedWeights ? normalizeWeights(initial.lockedWeights) : null);
  const criteria = ref<Criterion[]>(baseCriteria.map((item) => ({ ...item, weight: weights.value[item.id] })));
  const scores = ref<ScoreRecord[]>((initial.scores ?? []).map((score) => ({
    id: String(score.id ?? `${score.judge}-${score.schemeId}`),
    judge: score.judge,
    schemeId: score.schemeId,
    values: Object.fromEntries(baseCriteria.map((item) => {
      const value = Number(score.values?.[item.id]);
      return [item.id, Number.isFinite(value) ? value : 60];
    })),
    comment: typeof score.comment === "string" ? score.comment : "",
    submitted: Boolean(score.submitted),
    conflict: Boolean(score.conflict),
    weightVersion: Number.isInteger(score.weightVersion) ? score.weightVersion as number : weightVersion.value,
    updatedAt: typeof score.updatedAt === "string" ? score.updatedAt : new Date().toISOString()
  })));
  const events = ref<ReviewEvent[]>(initial.events ?? []);
  const published = ref<boolean>(initial.published ?? false);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const effectiveWeights = computed(() => lockedWeights.value ?? weights.value);
  const weightTotal = computed(() => Object.values(weights.value).reduce((sum, value) => sum + value, 0));
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  criteria.value = baseCriteria.map((item) => ({ ...item, weight: effectiveWeights.value[item.id] }));

  function syncCriteria() {
    criteria.value = baseCriteria.map((item) => ({ ...item, weight: effectiveWeights.value[item.id] }));
  }

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  function weightedScore(values: Record<string, number>, useWeights = effectiveWeights.value) {
    return criteria.value.reduce((sum, criterion) => sum + (Number(values[criterion.id]) || 0) * useWeights[criterion.id] / 100, 0);
  }

  function emptyScore(currentJudge: Viewer, schemeId: string): ScoreRecord {
    return {
      id: `${currentJudge}-${schemeId}`,
      judge: currentJudge,
      schemeId,
      values: Object.fromEntries(baseCriteria.map((item) => [item.id, 60])),
      comment: "",
      submitted: false,
      conflict: false,
      weightVersion: weightVersion.value,
      updatedAt: new Date().toISOString()
    };
  }

  function record(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  function isCurrent(item: ScoreRecord) {
    return item.submitted && item.weightVersion === weightVersion.value;
  }

  function needsReview(item?: ScoreRecord | null) {
    return Boolean(item?.submitted && item.weightVersion < weightVersion.value);
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || item.submitted || published.value) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.weightVersion = weightVersion.value;
    item.updatedAt = new Date().toISOString();
    log("保存评分草稿", `${schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}`);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || published.value) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = true;
    item.weightVersion = weightVersion.value;
    item.updatedAt = new Date().toISOString();
    log("提交评分", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function reuseOriginalScore(schemeId: string) {
    const item = record(schemeId);
    if (!item || !needsReview(item) || published.value) return;
    item.weightVersion = weightVersion.value;
    item.updatedAt = new Date().toISOString();
    log("沿用原分完成复核", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || published.value || !isCurrent(item)) return;
    item.submitted = false;
    item.weightVersion = weightVersion.value;
    log("退回评分修改", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function submittedRows(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && score.submitted);
  }

  function pendingReviewRows(schemeId: string) {
    return submittedRows(schemeId).filter((score) => score.weightVersion < weightVersion.value);
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  function allReviewedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && isCurrent(score)));
  }

  function getSchemeStatus(schemeId: string): Scheme["status"] {
    if (published.value) return "已锁定";
    const rows = submittedRows(schemeId);
    if (!rows.length) return "待评分";
    if (pendingReviewRows(schemeId).length) return "待复核";
    if (allReviewedFor(schemeId)) return "已提交";
    return "评分中";
  }

  function applyWeights(next: WeightMap) {
    if (!isOrganizer.value || published.value) return false;
    const normalized = normalizeWeights(next);
    const valid = Object.values(normalized).every((value) => Number.isInteger(value) && value >= 0 && value <= 100)
      && Object.values(normalized).reduce((sum, value) => sum + value, 0) === 100;
    if (!valid) return false;
    if (Object.keys(normalized).every((id) => normalized[id] === weights.value[id])) return true;

    weights.value = normalized;
    weightVersion.value += 1;
    scores.value.forEach((score) => {
      if (!score.submitted) score.weightVersion = weightVersion.value;
    });
    syncCriteria();
    log("调整评分权重", `权重版本 ${weightVersion.value}，已交评分进入待复核`);
    return true;
  }

  const ranking = computed(() => {
    if (!published.value) return [];
    const useWeights = effectiveWeights.value;
    return schemes.value.map((scheme) => {
      const rows = scores.value.filter((score) => score.schemeId === scheme.id && score.submitted && !score.conflict);
      const total = rows.length ? rows.reduce((sum, row) => sum + weightedScore(row.values, useWeights), 0) / rows.length : 0;
      const environmentAverage = rows.length
        ? rows.reduce((sum, row) => sum + (Number(row.values.sustain) || 0), 0) / rows.length
        : 0;
      return {
        ...scheme,
        total: roundScore(total),
        environmentAverage: roundScore(environmentAverage),
        judgeCount: rows.length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
      };
    }).filter((item) => item.judgeCount >= 2).sort(compareRanking);
  });

  const insufficientSamples = computed(() => {
    if (!published.value) return [];
    const useWeights = effectiveWeights.value;
    return schemes.value.map((scheme) => {
      const rows = scores.value.filter((score) => score.schemeId === scheme.id && score.submitted && !score.conflict);
      const total = rows.length ? rows.reduce((sum, row) => sum + weightedScore(row.values, useWeights), 0) / rows.length : 0;
      const environmentAverage = rows.length
        ? rows.reduce((sum, row) => sum + (Number(row.values.sustain) || 0), 0) / rows.length
        : 0;
      return {
        ...scheme,
        total: roundScore(total),
        environmentAverage: roundScore(environmentAverage),
        judgeCount: rows.length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
      };
    }).filter((item) => item.judgeCount < 2).sort(compareRanking);
  });

  function compareRanking(a: { total: number; judgeCount: number; environmentAverage: number }, b: { total: number; judgeCount: number; environmentAverage: number }) {
    if (a.total !== b.total) return b.total - a.total;
    if (a.judgeCount !== b.judgeCount) return b.judgeCount - a.judgeCount;
    return b.environmentAverage - a.environmentAverage;
  }

  const rankedResults = computed(() => {
    const groups: Array<Array<(typeof ranking.value)[number] & { rank: number }>> = [];
    ranking.value.forEach((item, index) => {
      const previous = ranking.value[index - 1];
      if (!previous || compareRanking(previous, item) !== 0) groups.push([]);
      groups[groups.length - 1].push({ ...item, rank: index + 1 });
    });
    return groups.flatMap((group) => group.map((item) => ({ ...item, tied: group.length > 1 })));
  });

  function publish() {
    if (!isOrganizer.value || published.value) return;
    if (!schemes.value.every((scheme) => allReviewedFor(scheme.id))) return;
    lockedWeights.value = { ...weights.value };
    published.value = true;
    syncCriteria();
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案`);
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  watch([scores, events, published, weights, weightVersion, lockedWeights], () => {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      published: published.value,
      weights: weights.value,
      weightVersion: weightVersion.value,
      lockedWeights: lockedWeights.value
    }));
  }, { deep: true });

  return {
    viewer,
    schemes,
    criteria,
    judges,
    scores,
    events,
    published,
    weights,
    weightVersion,
    lockedWeights,
    weightTotal,
    ranking,
    rankedResults,
    insufficientSamples,
    visibleScores,
    isOrganizer,
    judge,
    setViewer,
    record,
    saveDraft,
    submit,
    reuseOriginalScore,
    recalled,
    publish,
    applyWeights,
    allSubmittedFor,
    allReviewedFor,
    submittedRows,
    pendingReviewRows,
    getSchemeStatus,
    isCurrent,
    needsReview,
    weightedScore
  };
});
