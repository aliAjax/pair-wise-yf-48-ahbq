<script setup lang="ts">
import { computed, reactive } from "vue";
import { NAlert, NButton, NCard, NEmpty, NInputNumber, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const weightDraft = reactive<Record<string, number | null>>({ ...store.weights });
const weightTotal = computed(() => Object.values(weightDraft).reduce<number>((sum, value) => sum + (value ?? 0), 0));
const weightValid = computed(() => store.criteria.every((item) => Number.isInteger(weightDraft[item.id]) && (weightDraft[item.id] ?? 0) >= 0 && (weightDraft[item.id] ?? 0) <= 100) && weightTotal.value === 100);
const weightsChanged = computed(() => store.criteria.some((item) => Number(weightDraft[item.id]) !== item.weight));
const hasPendingReview = computed(() => store.schemes.some((scheme) => store.pendingReviewRows(scheme.id).length > 0));
const columns = [
  { title: "名次", key: "rank", width: 90 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "环境策略均分", key: "environmentAverage" },
  { title: "利益冲突", key: "conflicts" },
  { title: "加权总分", key: "total" }
];
const insufficientColumns = [
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "环境策略均分", key: "environmentAverage" },
  { title: "利益冲突", key: "conflicts" },
  { title: "参考加权总分", key: "total" }
];

function applyWeights() {
  const values = Object.fromEntries(store.criteria.map((item) => [item.id, Number(weightDraft[item.id])]));
  if (store.applyWeights(values)) {
    Object.assign(weightDraft, store.weights);
    message.success(store.scores.some((item) => item.submitted) ? "权重已生效，已交评分进入待复核" : "权重已生效");
  } else {
    message.warning("权重必须均为 0 到 100 的整数，且总和为 100");
  }
}

function publish() {
  if (!store.isOrganizer) {
    message.warning("只有主办方可以锁定结果");
    return;
  }
  if (hasPendingReview.value) {
    message.warning("仍有已交评分待评委复核，不能锁定结果");
    return;
  }
  const complete = store.schemes.every((scheme) => store.allReviewedFor(scheme.id));
  if (!complete) {
    message.warning("仍有评委未提交或未复核，不能锁定结果");
    return;
  }
  store.publish();
  message.success("评分结果已锁定发布");
}
</script>

<template>
  <NAlert v-if="!store.published && store.isOrganizer" type="warning" show-icon>结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度和复核状态。</NAlert>
  <NAlert v-else-if="!store.published" type="info" show-icon>结果尚未锁定，当前仅展示本人提交进度。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div>
          <b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>
            已提交 {{ store.submittedRows(scheme.id).length }} / {{ store.judges.length }}
            <template v-if="store.pendingReviewRows(scheme.id).length"> · 待复核 {{ store.pendingReviewRows(scheme.id).length }}</template>
          </small>
        </div>
        <NTag :type="store.allReviewedFor(scheme.id) ? 'success' : store.pendingReviewRows(scheme.id).length ? 'warning' : 'default'">
          {{ store.getSchemeStatus(scheme.id) }}
        </NTag>
      </article>
    </NCard>
    <NCard title="评分权重">
      <div class="weight-editor">
        <div v-for="item in store.criteria" :key="item.id" class="weight-row">
          <span>{{ item.name }}</span>
          <NInputNumber v-if="store.isOrganizer && !store.published" v-model:value="weightDraft[item.id]" :min="0" :max="100" :step="5" size="small" />
          <b v-else>{{ item.weight }}%</b>
        </div>
        <div class="weight-total">
          <span>权重合计</span>
          <NTag :type="weightTotal === 100 ? 'success' : 'error'">{{ weightTotal }}%</NTag>
        </div>
        <NButton v-if="store.isOrganizer && !store.published" type="primary" block :disabled="!weightValid || !weightsChanged" @click="applyWeights">应用权重调整</NButton>
        <p v-if="store.isOrganizer && !store.published" class="hint">调整后按新权重重算加权分；各项原打分和评审意见保留，相关评委全部复核后才能锁定。</p>
        <p v-else class="hint">权重在结果锁定后冻结，锁定后的调整不再生效。</p>
      </div>
    </NCard>
  </div>
  <NCard title="评分纪律" class="discipline-card">
    <div class="discipline">
      <p>评委只能查看自己的评分，主办方在锁定前无法读取分值。</p>
      <p>权重调整后，已交评分按新权重重算并进入待复核；评委可沿用原分或修改后重新提交。</p>
      <p>有效评委少于两人的方案单列“样本不足”，不进入正常名次；存在利益冲突的评分保留审计记录，但不参与排名。</p>
      <p>总分相同时先比有效评委人数，再比环境策略均分，仍相同才并列；锁定后不可修改。</p>
    </div>
    <NButton type="primary" block :disabled="!store.isOrganizer || store.published" @click="publish">锁定并发布结果</NButton>
  </NCard>
  <NCard title="最终排名" class="ranking">
    <NEmpty v-if="!store.published" description="锁定后查看最终排名" />
    <template v-else>
      <NEmpty v-if="!store.rankedResults.length" description="暂无有效评委达到两人的方案" />
      <NTable v-else :columns="columns" :data="store.rankedResults.map((item) => ({ ...item, rank: item.tied ? `${item.rank}（并列）` : item.rank }))" :bordered="false" />
    </template>
  </NCard>
  <NCard v-if="store.published && store.insufficientSamples.length" title="样本不足（单列，不计正常名次）" class="ranking">
    <NTable :columns="insufficientColumns" :data="store.insufficientSamples" :bordered="false" />
  </NCard>
</template>
