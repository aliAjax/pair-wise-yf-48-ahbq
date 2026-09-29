import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Criterion, ReviewEvent, Scheme, ScoreRecord, Viewer } from "../types";

const KEY = "pair-wise-yf-48/review";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];
const defaultWeights = [30, 25, 25, 20];
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
  weights?: number[];
  lockedWeights?: number[];
}

function isValidWeights(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === defaultWeights.length
    && value.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && Math.abs(value.reduce((sum, item) => sum + item, 0) - 100) < 0.001;
}

function loadState(): PersistedState {
  const saved = localStorage.getItem(KEY);
  if (!saved) return {};
  try {
    const parsed = JSON.parse(saved) as PersistedState;
    const scores = Array.isArray(parsed.scores) ? parsed.scores.map((score) => ({
      ...score,
      values: Object.fromEntries(baseCriteria.map((criterion) => [
        criterion.id,
        Number.isFinite(Number(score.values?.[criterion.id])) ? Number(score.values?.[criterion.id]) : 60
      ])),
      comment: typeof score.comment === "string" ? score.comment : "",
      conflict: Boolean(score.conflict),
      submitted: Boolean(score.submitted),
      needsReview: Boolean(score.needsReview),
      updatedAt: typeof score.updatedAt === "string" ? score.updatedAt : new Date().toISOString()
    })) : [];
    return { ...parsed, scores };
  } catch {
    return {};
  }
}

function withWeights(weights: number[]) {
  return baseCriteria.map((criterion, index) => ({ ...criterion, weight: weights[index] }));
}

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return {
    id: `${judge}-${schemeId}`,
    judge,
    schemeId,
    values: Object.fromEntries(baseCriteria.map((item) => [item.id, 60])),
    comment: "",
    submitted: false,
    needsReview: false,
    conflict: false,
    updatedAt: new Date().toISOString()
  };
}

export const useReviewStore = defineStore("review", () => {
  const initial = loadState();
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme })));
  const scores = ref<ScoreRecord[]>(initial.scores ?? []);
  const events = ref<ReviewEvent[]>(initial.events ?? []);
  const published = ref<boolean>(Boolean(initial.published));
  const weights = ref<number[]>(isValidWeights(initial.weights) ? [...initial.weights] : [...defaultWeights]);
  const lockedWeights = ref<number[] | null>(isValidWeights(initial.lockedWeights)
    ? [...initial.lockedWeights]
    : published.value && isValidWeights(initial.weights) ? [...initial.weights] : null);
  const criteria = computed(() => withWeights(published.value && lockedWeights.value ? lockedWeights.value : weights.value));

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  function statusFor(schemeId: string) {
    if (published.value) return "已锁定" as const;
    const rows = judges.map((name) => scores.value.find((score) => score.judge === name && score.schemeId === schemeId)).filter((item): item is ScoreRecord => Boolean(item));
    if (!rows.some((item) => item.submitted)) return "待评分" as const;
    if (rows.some((item) => item.submitted && item.needsReview)) return "待复核" as const;
    if (judges.every((name) => rows.some((item) => item.judge === name && item.submitted))) return "已提交" as const;
    return "评分中" as const;
  }

  function syncStatus(schemeId: string) {
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = statusFor(schemeId);
  }

  function syncStatuses() {
    schemes.value.forEach((scheme) => { scheme.status = statusFor(scheme.id); });
  }

  function findRecord(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    return scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId) ?? null;
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

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || item.submitted || published.value) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.updatedAt = new Date().toISOString();
    syncStatus(schemeId);
    log("保存评分草稿", `${schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}`);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || published.value) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = true;
    item.needsReview = false;
    item.reviewedWeights = [...weights.value];
    item.updatedAt = new Date().toISOString();
    syncStatus(schemeId);
    log("提交评分", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function confirmReview(schemeId: string) {
    const item = record(schemeId);
    if (!item || !item.submitted || published.value) return;
    item.needsReview = false;
    item.reviewedWeights = [...weights.value];
    item.updatedAt = new Date().toISOString();
    syncStatus(schemeId);
    log("复核评分", `${schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId}，沿用原分和原意见`);
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || published.value) return;
    item.submitted = false;
    item.needsReview = false;
    item.reviewedWeights = undefined;
    item.updatedAt = new Date().toISOString();
    syncStatus(schemeId);
    log("退回评分修改", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  function pendingReviewCountFor(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && score.submitted && score.needsReview).length;
  }

  function adjustWeights(nextWeights: number[]) {
    if (published.value || !isValidWeights(nextWeights)) return false;
    if (nextWeights.every((value, index) => value === weights.value[index])) return false;
    weights.value = [...nextWeights];
    scores.value.forEach((score) => {
      if (score.submitted) score.needsReview = true;
    });
    syncStatuses();
    log("调整评分权重", criteria.value.map((criterion) => `${criterion.name} ${criterion.weight}%`).join("、"));
    return true;
  }

  const ranking = computed(() => {
    if (!published.value) return [];
    const activeWeights = lockedWeights.value ?? weights.value;
    return schemes.value.map((scheme) => {
      const rows = scores.value.filter((score) => score.schemeId === scheme.id && score.submitted && !score.conflict);
      const weightedRows = rows.map((row) => baseCriteria.reduce((value, criterion, index) => value + row.values[criterion.id] * activeWeights[index] / 100, 0));
      const totalValue = weightedRows.length ? weightedRows.reduce((sum, value) => sum + value, 0) / weightedRows.length : 0;
      const environmentValues = rows.map((row) => row.values.sustain);
      const environmentValue = environmentValues.length ? environmentValues.reduce((sum, value) => sum + value, 0) / environmentValues.length : null;
      return {
        ...scheme,
        total: Number(totalValue.toFixed(2)),
        environmentAverage: environmentValue === null ? null : Number(environmentValue.toFixed(2)),
        judgeCount: rows.length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
      };
    }).sort((a, b) =>
      b.total - a.total
      || b.judgeCount - a.judgeCount
      || (b.environmentAverage ?? -1) - (a.environmentAverage ?? -1)
    );
  });

  const normalRanking = computed(() => {
    let rank = 0;
    return ranking.value.filter((item) => item.judgeCount >= 2).map((item, index, rows) => {
      const previous = rows[index - 1];
      if (!previous || previous.total !== item.total || previous.judgeCount !== item.judgeCount || previous.environmentAverage !== item.environmentAverage) {
        rank = index + 1;
      }
      return { ...item, rank };
    });
  });
  const insufficientSamples = computed(() => ranking.value.filter((item) => item.judgeCount < 2));

  function publish() {
    if (!isOrganizer.value || published.value) return;
    if (!schemes.value.every((scheme) => allSubmittedFor(scheme.id))) return;
    if (schemes.value.some((scheme) => pendingReviewCountFor(scheme.id) > 0)) return;
    published.value = true;
    lockedWeights.value = [...weights.value];
    syncStatuses();
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案`);
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  syncStatuses();

  watch([scores, events, published, weights, lockedWeights], () => {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      published: published.value,
      weights: weights.value,
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
    ranking,
    normalRanking,
    insufficientSamples,
    visibleScores,
    isOrganizer,
    judge,
    setViewer,
    findRecord,
    record,
    saveDraft,
    submit,
    confirmReview,
    recalled,
    allSubmittedFor,
    pendingReviewCountFor,
    adjustWeights,
    publish
  };
});
