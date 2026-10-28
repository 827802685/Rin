#!/usr/bin/env python3.11
"""
iter.py — Rin 自主迭代引擎（遵循用户给定的全部规则）

远端操作全部走 rinlib（GitHub REST API，规避 github.com:443 封锁）。
本地工作副本用于：实现改动 + 运行 bun 构建/测试门禁。
提交以「单提交多文件」方式推送到 auto 分支（保留迭代历史）。
每完成 5 次成功迭代，将 auto 合并到 main。

用法:
  python3.11 iter.py            # 执行一次迭代（自动从 state.json 取编号）
  python3.11 iter.py --iter N   # 指定迭代编号（覆盖）
  python3.11 iter.py --dry      # 只分析+选目标，不提交
"""
import os, sys, json, subprocess, shutil, datetime, argparse, textwrap

HERE = '/root/rin-iteration'
REPO = os.environ.get('RIN_LOCAL', '/workspace/Rin')
# 状态文件统一放在仓库内 scripts/auto-iter/state.json，便于 GitHub Actions 持久化（在 auto 分支上提交）
STATE = os.environ.get('RIN_STATE', os.path.join(REPO, 'scripts', 'auto-iter', 'state.json'))
SYSYNC = os.environ.get('RIN_SYNC', '1') != '0'   # Actions 中由 checkout 提供文件时可置 0
sys.path.insert(0, HERE)
import rinlib

# ---------- 状态 ----------
def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {'iteration': 0, 'since_merge': 0, 'last_merge_iter': 0, 'history': []}

def save_state(s):
    json.dump(s, open(STATE, 'w'), indent=2)

# ---------- 构建/测试门禁 ----------
def run(cmd, cwd):
    """返回 (rc, stdout_tail)。"""
    print(f'  $ {cmd}  (cwd={cwd})')
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=600)
    out = (p.stdout + p.stderr)[-3000:]
    print(f'    rc={p.returncode}  (last lines)\n' + textwrap.indent(out[-1200:], '    '))
    return p.returncode, out

def gate_build():
    """Build 门禁 = bun run check（turbo 类型检查，覆盖 client/server/cli）。"""
    rc, _ = run('bun run check', REPO)
    return rc == 0

def gate_test():
    """Test 门禁 = 分工作区运行（根 bun test 已知会失败，按 AGENTS.md 用分工作区命令）。"""
    ok = True
    for ws in ('server', 'client'):
        rc, _ = run('bun run test', os.path.join(REPO, ws))
        ok = ok and rc == 0
    return ok

# ---------- 目标选择（规则化队列 + 可选 LLM） ----------
REQUIRED_IGNORE = [
    'build/', 'dist/', 'target/', 'out/', 'coverage/', 'test-results/', 'logs/',
    'output/', '.workbuddy/', 'node_modules/', '.venv/', 'env/', 'vendor/', '*.log', '*.tmp',
]

def task_gitignore():
    """规则要求：确保 .gitignore 覆盖所有产物目录。返回 (changes, summary) 或 (None, reason)。"""
    p = os.path.join(REPO, '.gitignore')
    cur = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    lines = [l.strip() for l in cur.splitlines() if l.strip() and not l.startswith('#')]
    missing = [m for m in REQUIRED_IGNORE if m not in lines]
    if not missing:
        return None, 'gitignore 已覆盖全部要求项'
    new = cur.rstrip() + '\n\n# --- auto-iter: 补齐产物/缓存忽略规则（迭代规范要求） ---\n'
    new += '\n'.join(missing) + '\n'
    return {'.gitignore': new}, f'补全 .gitignore 缺失的忽略项: {", ".join(missing)}'

def task_ci_hardening():
    """为 .github/workflows/*.yml 增加 timeout-minutes 与 concurrency（CI 健壮性，可独立验证）。"""
    wfdir = os.path.join(REPO, '.github', 'workflows')
    if not os.path.isdir(wfdir):
        return None, '无 workflows 目录'
    import re
    changes = {}
    changed_any = False
    for fn in os.listdir(wfdir):
        if not fn.endswith('.yml') and not fn.endswith('.yaml'):
            continue
        fp = os.path.join(wfdir, fn)
        txt = open(fp, encoding='utf-8').read()
        if 'concurrency:' in txt or 'timeout-minutes:' in txt:
            continue
        # 在每个 job 下注入 timeout-minutes: 30
        txt2 = re.sub(r'(\n\s{2})(runs-on: .+)', r'\1\2\n\1timeout-minutes: 30', txt)
        if txt2 != txt:
            changes[f'.github/workflows/{fn}'] = txt2
            changed_any = True
    if not changed_any:
        return None, 'workflows 已具备 timeout/concurrency'
    return changes, f'为 {len(changes)} 个 workflow 增加 timeout-minutes（CI 健壮性）'

def choose_target(iter_num):
    """返回 (action_type, summary, changes) 或 (None, reason, None)。"""
    # 规则化队列：依次尝试安全的、可独立验证的改进
    queue = [task_gitignore, task_ci_hardening]
    for fn in queue:
        changes, reason = fn()
        if changes:
            return '修复功能', reason, changes
    return None, '无可自动执行的规则化改进（需 LLM 或人工介入）', None

# ---------- 应用改动到本地 ----------
def apply_local(changes):
    for path, content in changes.items():
        fp = os.path.join(REPO, path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)

# ---------- 提交（单提交多文件） ----------
def build_message(iter_num, action, summary, build_pass, test_pass):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return (
        f'{action.lower() if False else "chore"}: auto-iter #{iter_num} {summary}\n\n'
        f'Iteration: {iter_num}\n'
        f'Branch: auto\n'
        f'Action: {action}\n'
        f'Summary: {summary}\n'
        f'Build: {"PASS" if build_pass else "FAIL"}\n'
        f'Tests: {"PASS" if test_pass else "FAIL"}\n'
        f'Timestamp: {ts}\n'
    )

# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--iter', type=int, default=None)
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    st = load_state()
    iter_num = args.iter if args.iter else st['iteration'] + 1
    print(f'===== Rin 迭代 #{iter_num} =====')

    # 1) 同步最新基线：优先 auto（迭代所在分支，避免重复已做的改动），否则 main
    sync_ref = 'auto' if rinlib.branch_exists('auto') else 'main'
    if SYSYNC:
        print(f'[1] 同步 {sync_ref} 分支最新代码 (api.github.com) ...')
        rinlib.sync_local(sync_ref, REPO)
    else:
        print(f'[1] 跳过同步（RIN_SYNC=0，使用本地/checkout 的 {sync_ref} 文件）')

    # 2) 切换/确保 auto 分支
    print('[2] 确保 auto 分支 ...')
    main_sha = rinlib.get_ref_sha('main')
    if not rinlib.branch_exists('auto'):
        rinlib.create_branch('auto', main_sha)
        print('    创建 auto 分支 (基于 main)')
    else:
        # 基于最新主分支更新 auto：将 main 合并进 auto（保留未合并的迭代提交）
        merged = rinlib.merge('main', 'auto')
        print(f'    合并 main->auto: {merged or "已是最新/无操作"}')

    # 3) 分析 + 选目标
    print('[3] 分析项目状态并选择迭代目标 ...')
    action, summary, changes = choose_target(iter_num)
    if not changes:
        print(f'    无可用目标: {summary}')
        print('Iteration: %d\nBranch: auto\nAction: 无\nSummary: %s\nBuild: SKIP\nTests: SKIP' % (iter_num, summary))
        return
    print(f'    目标 -> Action={action} | {summary}')

    if args.dry:
        print('[dry] 不提交。改动文件:', list(changes.keys()))
        return

    # 5) 实施最小可验证改动
    print('[5] 实施改动 ...')
    apply_local(changes)

    # 6/7) 构建 + 测试
    print('[6] 运行构建 (bun run check) ...')
    build_pass = gate_build()
    print('[7] 运行测试 (server/client) ...')
    test_pass = gate_test()

    if not (build_pass and test_pass):
        print('[!] 构建或测试未通过，按规则回退改动（不提交）。')
        print(f'Iteration: {iter_num}\nBranch: auto\nAction: {action}\nSummary: {summary}\nBuild: {"PASS" if build_pass else "FAIL"}\nTests: {"PASS" if test_pass else "FAIL"}')
        # 回退：重新同步 main（丢弃本地改动）
        rinlib.sync_local('main', REPO)
        return

    # 9) 提交（含迭代编号/类型/摘要/构建测试结果）
    print('[9] 提交到 auto 分支 ...')
    msg = build_message(iter_num, action, summary, build_pass, test_pass)
    sha = rinlib.put_commit('auto', changes, msg)
    print('    提交:', sha)

    # 状态更新
    st['iteration'] = iter_num
    st['since_merge'] = st.get('since_merge', 0) + 1
    st['history'].append({'iter': iter_num, 'action': action, 'summary': summary,
                          'build': 'PASS' if build_pass else 'FAIL',
                          'tests': 'PASS' if test_pass else 'FAIL', 'sha': sha[:10], 'ts': msg.split('Timestamp: ')[-1].strip()})
    save_state(st)

    # 10) 报告
    print('\n' + '-' * 50)
    print(f'Iteration: {iter_num}')
    print('Branch: auto')
    print(f'Action: {action}')
    print(f'Summary: {summary}')
    print(f'Build: {"PASS" if build_pass else "FAIL"}')
    print(f'Tests: {"PASS" if test_pass else "FAIL"}')
    print('Files Changed:', ', '.join(changes.keys()))
    print('Ignored Artifacts: build/, dist/, target/, out/, coverage/, test-results/, logs/, output/, .workbuddy/, node_modules/, .venv/, env/, vendor/, *.log, *.tmp')
    print(f'Next Step: since_merge={st["since_merge"]}')

    # 合并规则：每 5 次成功迭代合并 auto->main
    if st['since_merge'] >= 5:
        print('\n[合并] 已达 5 次成功迭代，合并 auto -> main ...')
        msha = rinlib.merge('auto', 'main')
        if msha:
            rinlib.update_ref('auto', msha, force=True)  # 合并后 auto 基于最新 main
            st['since_merge'] = 0
            st['last_merge_iter'] = iter_num
            save_state(st)
            print(f'    合并提交: {msha}；auto 已重置到 main')
        else:
            print('    合并跳过（无新内容或冲突）')

if __name__ == '__main__':
    main()
