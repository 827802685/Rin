// Live2D 模型下载进度的展示计算（百分比 / 已下载 MB 文案）。
//
// 纯函数模块：无 DOM、无 React 依赖，行为与 live2d-widget.tsx 拆分前的内联表达式等价。
// 分母语义：内置模型用 EXPECTED_TOTAL_BY_NAME 的精确总字节；total=0 表示总量未知
// （自定义模型），此时百分比返回 null、MB 文案只显示已下载量。

export type ProgressState = { loaded: number; total: number };

// 加载进度百分比（0-100）；未开始/总量未知时为 null（UI 只显示已下载量）。
export function progressPercent(progress: ProgressState | null): number | null {
  return progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;
}

const BYTES_PER_MB = 1048576;

// MB 文案：total 已知 → "已下载 / 总量 MB"；未知 → "已下载 MB"。保留 1 位小数。
export function formatProgressMb(progress: ProgressState): string {
  const loaded = (progress.loaded / BYTES_PER_MB).toFixed(1);
  return progress.total > 0
    ? `${loaded} / ${(progress.total / BYTES_PER_MB).toFixed(1)} MB`
    : `${loaded} MB`;
}
