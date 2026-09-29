<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const needsReview = computed(() => store.needsReview(currentScore.value));
const form = reactive({ values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>, comment: "", conflict: false });
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

watch(selectedId, () => {
  const score = store.record(selected.value.id);
  form.values = { ...(score?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = score?.comment ?? "";
  form.conflict = score?.conflict ?? false;
}, { immediate: true });

const status = computed(() => store.getSchemeStatus(selected.value.id));
const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || store.published || Boolean(currentScore.value?.submitted && !needsReview.value));

function draft() {
  store.saveDraft(selected.value.id, form.values, form.comment, form.conflict);
  message.success("评分草稿已保存到本地");
}
function submit(reuseOriginal = false) {
  if (reuseOriginal) {
    store.reuseOriginalScore(selected.value.id);
    message.success("已沿用原分完成复核");
    return;
  }
  validate({ values: form } as any).then((result) => {
    if (!result.valid) return;
    store.submit(selected.value.id, form.values, form.comment, form.conflict);
    message.success(needsReview.value ? "新权重评分已重新提交" : "匿名评分已提交");
  });
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ store.getSchemeStatus(item.id) }}</small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div><NTag :type="status === '已锁定' ? 'success' : status === '待复核' ? 'warning' : 'default'">{{ status }}</NTag></div></template>
      <NAlert v-if="needsReview" type="warning" show-icon class="review-alert">评分权重已调整，原打分和意见已保留。请沿用原分完成复核，或修改后重新提交。</NAlert>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id"><div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] }} / {{ item.max }}</small></article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions">
        <NButton :disabled="disabled || currentScore?.submitted" @click="draft">保存草稿</NButton>
        <NButton v-if="needsReview" :disabled="store.published" @click="submit(true)">沿用原分完成复核</NButton>
        <NButton type="primary" :disabled="disabled" @click="submit(false)">{{ needsReview ? "修改后重新提交" : "提交本方案评分" }}</NButton>
        <NButton v-if="currentScore?.submitted && !needsReview && !store.published" quaternary @click="store.recalled(selected.id)">退回修改</NButton>
      </div>
    </NCard>
  </div>
</template>
