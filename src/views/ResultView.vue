<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { NAlert, NButton, NCard, NEmpty, NInputNumber, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const weightDraft = reactive({ values: store.weights.map((value) => value) as (number | null)[] });
const weightTotal = computed(() => Math.round(weightDraft.values.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100);
const weightsValid = computed(() => Math.abs(weightTotal.value - 100) < 0.001 && weightDraft.values.every((value) => value !== null && value >= 0));
const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "利益冲突", key: "conflicts" },
  { title: "环境策略均分", key: "environmentAverage" },
  { title: "加权总分", key: "total" }
];

watch(() => store.weights, (values) => {
  weightDraft.values = values.map((value) => value);
}, { deep: true });

function applyWeights() {
  if (!weightsValid.value) {
    message.warning("四个维度权重必须为非负数，且总和保持 100");
    return;
  }
  if (store.adjustWeights(weightDraft.values.map((value) => Number(value)))) {
    message.warning("新权重已生效，已提交评分进入待复核");
  }
}

function publish() {
  if (!store.isOrganizer) {
    message.warning("仅主办方可以锁定结果");
    return;
  }
  const incomplete = store.schemes.some((scheme) => !store.allSubmittedFor(scheme.id));
  if (incomplete) {
    message.warning("仍有评委未提交，不能锁定结果");
    return;
  }
  const pending = store.schemes.reduce((sum, scheme) => sum + store.pendingReviewCountFor(scheme.id), 0);
  if (pending > 0) {
    message.warning(`还有 ${pending} 份评分待复核，涉及评委全部复核后才能锁定`);
    return;
  }
  store.publish();
  message.success("评分结果已锁定发布；后续权重调整不再生效");
}
</script>
<template>
  <NAlert v-if="!store.published" type="warning" show-icon>结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div>
          <b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>{{ store.judges.filter((judge) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judge && score.submitted)).length }} / {{ store.judges.length }} 已提交
            <template v-if="store.pendingReviewCountFor(scheme.id) > 0"> · {{ store.pendingReviewCountFor(scheme.id) }} 份待复核</template>
          </small>
        </div>
        <NTag :type="store.pendingReviewCountFor(scheme.id) ? 'warning' : store.allSubmittedFor(scheme.id) ? 'success' : 'default'">
          {{ store.pendingReviewCountFor(scheme.id) ? "待复核" : store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}
        </NTag>
      </article>
    </NCard>
    <div class="side-stack">
      <NCard v-if="store.isOrganizer" title="评分维度权重" class="weights-card">
        <div class="weight-row" v-for="(criterion, index) in store.criteria" :key="criterion.id">
          <div><b>{{ criterion.name }}</b><small>{{ criterion.description }}</small></div>
          <NInputNumber v-model:value="weightDraft.values[index]" :min="0" :max="100" :show-button="false" :disabled="store.published" style="width: 92px" />
          <span>%</span>
        </div>
        <div class="weight-total" :class="{ invalid: !weightsValid }">当前合计：{{ weightTotal }}%</div>
        <NAlert v-if="store.published" type="success" show-icon>结果已锁定，当前权重为锁定快照，调整不再生效。</NAlert>
        <NAlert v-else type="info" show-icon style="margin: 10px 0">调整后四个维度总和须为 100；原打分和意见保留，已交评分将按新权重重算并待复核。</NAlert>
        <NButton type="primary" block :disabled="store.published || !weightsValid" @click="applyWeights">应用新权重</NButton>
      </NCard>
      <NCard title="评分纪律">
        <div class="discipline">
          <p>评委只能查看自己的评分，主办方在锁定前无法读取分值。</p>
          <p>存在利益冲突的评分保留审计记录，但不参与最终排名。</p>
          <p>权重调整后，涉及评委必须沿用原分或重新提交，全部复核完才可锁定。</p>
          <p>有效评委不到两人的方案单列“样本不足”，不进入正常名次。</p>
          <p>评分提交后可由评委主动退回，结果锁定后不可修改。</p>
        </div>
        <NButton type="primary" block :disabled="store.published || !store.isOrganizer" @click="publish">锁定并发布结果</NButton>
      </NCard>
    </div>
  </div>
  <NCard title="最终排名" class="ranking">
    <NEmpty v-if="!store.published" description="锁定后查看最终排名" />
    <template v-else>
      <NEmpty v-if="store.normalRanking.length === 0" description="暂无有效评委达到两人的正常名次" />
      <NTable v-else :columns="columns" :data="store.normalRanking" :bordered="false" />
    </template>
  </NCard>
  <NCard v-if="store.published && store.insufficientSamples.length > 0" title="样本不足（不计入正常名次）" class="ranking insufficient-card">
    <NTable :columns="columns.filter((column) => column.key !== 'rank')" :data="store.insufficientSamples" :bordered="false" />
  </NCard>
</template>
