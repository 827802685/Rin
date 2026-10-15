// Live2D 模型下载进度的展示计算（百分比 / 已下载 MB 文案）。
//
// 纯函数模块：无 DOM、无 React 依赖。
// 分母语义：内置模型用 EXPECTED_TOTAL_BY_NAME 的精确总字节；total=0 表示总量未知
//（自定义模型），此时百分比返回 null、MB 文案只显示已下载量。
//
// loaded > total 只可能是分母算错或换模型没换分母（线上真出过：切到 furina 后显示
//「100% + 73.8 / 5.6 MB」）。两处分别处理：百分比按"至少已下完"钳在 100（末尾只差
// 几千字节时不该退回 0 闪一下），MB 文案则丢掉不可信的分母、只显示已下载量。

export type ProgressState = { loaded: number; total: number };

// 分母可信 ⇔ 已知总量且分子没超过它。
function hasKnownTotal(progress: ProgressState): boolean {
  return progress.total > 0 && progress.loaded <= progress.total;
}

// 加载进度百分比（0-100）；未开始或总量未知时为 null（UI 只显示已下载量）。
export function progressPercent(progress: ProgressState | null): number | null {
  return progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;
}

const BYTES_PER_MB = 1048576;

// MB 文案：分母可信 → "已下载 / 总量 MB"；否则 → "已下载 MB"。保留 1 位小数。
export function formatProgressMb(progress: ProgressState): string {
  const loaded = (progress.loaded / BYTES_PER_MB).toFixed(1);
  return hasKnownTotal(progress)
    ? `${loaded} / ${(progress.total / BYTES_PER_MB).toFixed(1)} MB`
    : `${loaded} MB`;
}
